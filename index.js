'use strict'

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')
const { validateOpts } = require('./lib/validation')

module.exports = fp(async function (app, opts) {
  validateOpts(opts)

  let { all, policy, ttl, cacheSize, skip, storage, onHit, onMiss, onSkip } = opts

  onHit = onHit || noop
  onMiss = onMiss || noop
  onSkip = onSkip || noop

  let cache = null

  app.graphql.cache = {
    refresh () {
      buildCache()
      setupSchema(app.graphql.schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip)
    },

    clear () {
      cache.clear()
    }
  }

  app.addHook('onReady', async () => {
    app.graphql.cache.refresh()
  })

  // Add hook to regenerate the resolvers when the schema is refreshed
  app.graphql.addHook('onGatewayReplaceSchema', async (instance, schema) => {
    buildCache()
    setupSchema(schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip)
  })

  function buildCache () {
    cache = new Cache({
      ttl,
      cacheSize
    })
  }
}, {
  fastify: '^3.x',
  dependencies: ['mercurius']
})

function setupSchema (schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip) {
  const schemaTypeMap = schema.getTypeMap()
  let queryKeys = policy ? Object.keys(policy.Query) : []

  for (const schemaType of Object.values(schemaTypeMap)) {
    const fieldPolicy = all || policy[schemaType]
    if (!fieldPolicy) {
      continue
    }

    // Handle fields on schema type
    if (typeof schemaType.getFields === 'function') {
      for (const [fieldName, field] of Object.entries(schemaType.getFields())) {
        const policy = fieldPolicy[fieldName]
        if (all || policy) {
          // validate schema vs query values
          queryKeys = queryKeys.filter(key => key !== fieldName)
          // Override resolvers for caching purposes
          if (typeof field.resolve === 'function') {
            const originalFieldResolver = field.resolve
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver, policy, skip, storage, onHit, onMiss, onSkip)
          }
        }
      }
    }
  }
  if (queryKeys.length) { throw new Error('Query does not match schema') }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver, policy, skip, storage, onHit, onMiss, onSkip) {
  const name = prefix + '.' + fieldName
  onHit = onHit.bind(null, prefix, fieldName)
  onMiss = onMiss.bind(null, prefix, fieldName)
  onSkip = onSkip.bind(null, prefix, fieldName)

  cache.define(name, {
    onHit,
    ttl: policy && policy.ttl,
    cacheSize: policy && policy.cacheSize,
    serialize ({ self, arg, info, ctx }) {
      // We need to cache only for the selected fields to support Federation
      // TODO detect if we really need to do this in most cases
      const fields = []
      for (const node of info.fieldNodes) {
        if (!node.selectionSet) {
          continue
        }
        for (const selection of node.selectionSet.selections) {
          fields.push(selection.name.value)
        }
      }
      fields.sort()

      let extendKey
      if (policy && policy.extendKey) {
        const append = policy.extendKey(self, arg, ctx, info)
        if (append) {
          extendKey = '~' + append
        }
      }

      // We must skip ctx and info as they are not easy to serialize
      return { self, arg, fields, extendKey }
    }
  }, async function ({ self, arg, ctx, info, extendKey }, key) {
    if (storage) {
      const val = await storage.get(name + '~' + key)
      if (val) {
        onHit()
        return val
      }
    }
    onMiss()
    const res = await originalFieldResolver(self, arg, ctx, info)
    if (storage) {
      await storage.set(name + '~' + key, res)
    }
    return res
  })
  return async function (self, arg, ctx, info) {
    const isMutation =
      info.operation && info.operation.operation === 'mutation'
    if (
      (skip && (await skip(self, arg, ctx, info))) ||
      isMutation ||
      (policy && policy.skip && (await policy.skip(self, arg, ctx, info)))
    ) {
      if (!isMutation) onSkip()
      return originalFieldResolver(self, arg, ctx, info)
    }
    return cache[name]({ self, arg, ctx, info })
  }
}

function noop () { }
