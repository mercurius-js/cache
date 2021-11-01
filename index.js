'use strict'

const fp = require('fastify-plugin')
const stringify = require('safe-stable-stringify')
const storageCreate = require('./storage')

module.exports = fp(async function (app, { storage, ttl, skip, all, policy, onHit, onMiss, onSkip }) {
  if (typeof policy !== 'object' && !all) {
    throw new Error('policy must be an object')
  } else if (all && policy) {
    throw new Error('policy and all options are exclusive')
  }

  // TODO validate fastify-redis is already registered on storage redis
  // TODO validate mercurius is already registered
  // TODO validate options

  onHit = onHit || noop
  onMiss = onMiss || noop
  onSkip = onSkip || noop

  let cache, dedupe

  app.graphql.cache = {
    async refresh () {
      await refresh(app.graphql.schema)
    },

    async clear () {
      await cache.clear()
    }

    // TODO fastify.decorate('invalidate', function () {})
  }

  app.addHook('onReady', async () => {
    await app.graphql.cache.refresh()
  })

  // Add hook to regenerate the resolvers when the schema is refreshed
  app.graphql.addHook('onGatewayReplaceSchema', async (instance, schema) => {
    await refresh(schema)
  })

  function buildCache () {
    cache = storageCreate(storage.type, storage.options)
    dedupe = new Map()
  }

  function refresh (schema) {
    buildCache()
    setupSchema(schema, cache, dedupe, ttl, policy, all, skip, onHit, onMiss, onSkip, app.log)
  }
})

function setupSchema (schema, cache, dedupe, ttl, policy, all, skip, onHit, onMiss, onSkip, log) {
  const schemaTypeMap = schema.getTypeMap()
  const schemaTypeNames = Object.keys(schemaTypeMap)
  for (let i = 0; i < schemaTypeNames.length; i++) {
    const schemaType = schemaTypeMap[schemaTypeNames[i]]
    const fieldPolicy = all || policy[schemaType]
    if (!fieldPolicy) {
      continue
    }

    // Handle fields on schema type
    if (typeof schemaType.getFields === 'function') {
      const fields = schemaType.getFields()
      const fieldNames = Object.keys(fields)
      for (let j = 0; j < fieldNames.length; j++) {
        const fieldName = fieldNames[j]
        const field = fields[fieldName]
        const policy = fieldPolicy[fieldName]
        if (all || policy) {
          // Override resolvers for caching purposes
          if (typeof field.resolve === 'function') {
            const originalFieldResolver = field.resolve
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, originalFieldResolver, cache, dedupe, ttl, policy, skip, onHit, onMiss, onSkip, log)
          }
        }
      }
    }
  }
}

function makeCachedResolver (prefix, fieldName, originalFieldResolver, cache, dedupe, ttl, policy, skip, onHit, onMiss, onSkip, log) {
  const name = prefix + '.' + fieldName
  onHit = onHit.bind(null, prefix, fieldName)
  onMiss = onMiss.bind(null, prefix, fieldName)
  onSkip = onSkip.bind(null, prefix, fieldName)
  ttl = policy && policy.ttl !== undefined ? policy.ttl : ttl
  const extendKey = policy && policy.extendKey
  const policySkip = policy && policy.skip
  const references = policy && policy.references
  const invalidate = policy && policy.invalidate

  /**
   * serialize the resolver
   * it create the key/hash of the request (serialize the main request parts)
   */
  async function hash ({ self, arg, info, ctx }) {
    // We need to cache only for the selected fields to support Federation
    // TODO detect if we really need to do this in most cases
    const fields = []
    for (let i = 0; i < info.fieldNodes.length; i++) {
      const node = info.fieldNodes[i]
      if (!node.selectionSet) {
        continue
      }
      // TODO optimize code
      for (let j = 0; j < node.selectionSet.selections.length; j++) {
        const selection = node.selectionSet.selections[j]
        fields.push(selection.name.value)
      }
    }
    fields.sort()

    let extendedKey
    if (extendKey) {
      const append = await extendKey(self, arg, ctx, info)
      if (append) {
        extendedKey = '~' + append
      }
    }

    // We must skip ctx and info as they are not easy to serialize
    // in case we need context data, we can add to the key using the extendKey function

    return stringify({ self, arg, fields, extendedKey })
  }

  /**
   * get data from cache or from original resolver, and store it (with references)
   */
  async function get ({ self, arg, ctx, info }, key) {
    const cacheKey = name + '~' + key
    const data = await cache.get(cacheKey)
    if (data) {
      onHit()
      return data
    }

    onMiss()
    const result = await originalFieldResolver(self, arg, ctx, info)

    if(ttl < 1) {
      return result
    }

    if (!references) {
      log.debug({ msg: `cache store (no references) key: "${key}"` })
      await cache.set(cacheKey, result, ttl)
      return result
    }

    let referencesKeys
    try {
      referencesKeys = references(self, arg, ctx, info, result)
    } catch (err) {
      // this can't never throw
      // TODO onError()?
      log.error({ msg: 'error on getting references', err })
    }

    log.debug({ msg: `cache store key: "${key}" with references`, references: referencesKeys })
    await cache.set(cacheKey, result, ttl, referencesKeys)
    return result
  }

  /**
   * wrap the original resolver in order to:
   * - dedupe requests to original resolver and to cache
   * - avoid cache for mutations
   * - skip cache on options.skip or options.policy.skip
   * - invalidate cache by references
   */
  return async function resolveWrapper (self, arg, ctx, info) {
    const key = await hash({ self, arg, ctx, info })

    // queue resolver by key
    // collect all the same requests while they are resolved
    // then resolve them all at once
    let pending = dedupe.get(key)
    if (pending) {
      return await pending
    }

    const resolver = async () => {
      let result
      try {
        // do not use cache for mutation
        // TODO need to dedupe mutations? if not, we can avoid hashing
        if (info.operation.operation === 'mutation') {
          log.debug({ msg: 'mutation, no cache' })
          result = await originalFieldResolver(self, arg, ctx, info)
        } else if ((skip && await skip(self, arg, ctx, info)) ||
          (policySkip && await policySkip(self, arg, ctx, info))) {
          onSkip()
          result = await originalFieldResolver(self, arg, ctx, info)
        } else {
          result = await get({ self, arg, ctx, info }, key)
        }
      } catch (err) {
        // this can't never throw
        // TODO onError()?
        log.error({ msg: 'error on cache resolver wrapper', err })
      }

      // invalidate related cache entries
      // note: no gc, because must be sync
      if (invalidate) {
        log.debug({ msg: 'invalidate' })
        await cache.invalidate(invalidate(self, arg, ctx, info, result))
      }

      dedupe.delete(key)
      return result
    }
    pending = resolver()

    dedupe.set(key, pending)
    return await pending
  }
}

function noop () { }
