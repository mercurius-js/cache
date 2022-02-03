'use strict'

const fp = require('fastify-plugin')
const { createCache } = require('async-cache-dedupe')
const { validateOpts } = require('./lib/validation')
const createReport = require('./lib/report')

module.exports = fp(async function (app, opts) {
  const { all, policy, ttl, skip, storage, onDedupe, onHit, onMiss, onSkip, onError, logInterval, logReport } = validateOpts(app, opts)

  let cache = null
  let report = null

  app.graphql.cache = {
    refresh () {
      buildCache()
      setupSchema(app.graphql.schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, onError, report)
    },

    clear () {
      cache.clear()
      report.clear()
    }
  }

  app.addHook('onReady', async () => {
    app.graphql.cache.refresh()
    report.refresh()
  })

  app.addHook('onClose', () => {
    report && report.close()
  })

  // Add hook to regenerate the resolvers when the schema is refreshed
  app.graphql.addHook('onGatewayReplaceSchema', async (instance, schema) => {
    buildCache()
    setupSchema(schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, onError, report)
  })

  function buildCache () {
    // Default the first two parameters of onError(prefix, fieldName, err)
    cache = createCache({ ttl, storage, onError: onError.bind(null, 'Internal Error', 'async-cache-dedupe') })
    report = createReport({ app, all, policy, logInterval, logReport })
  }
}, {
  fastify: '^3.x',
  dependencies: ['mercurius']
})

function setupSchema (schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, onError, report) {
  const schemaTypeMap = schema.getTypeMap()
  let queryKeys = policy ? Object.keys(policy.Query || {}) : []

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
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, onError, report)
          }
        }
      }
    }
  }
  if (queryKeys.length) { throw new Error(`Query does not match schema: ${queryKeys}`) }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, onError, report) {
  const name = prefix + '.' + fieldName

  onDedupe = onDedupe.bind(null, prefix, fieldName)
  onHit = onHit.bind(null, prefix, fieldName)
  onMiss = onMiss.bind(null, prefix, fieldName)
  onSkip = onSkip.bind(null, prefix, fieldName)
  onError = onError.bind(null, prefix, fieldName)

  report.wrap({ name, onDedupe, onHit, onMiss, onSkip })

  let ttl, storage, references, invalidate
  if (policy) {
    ttl = policy.ttl
    storage = policy.storage
    references = policy.references
    invalidate = policy.invalidate
  }

  cache.define(name, {
    onDedupe: report[name].onDedupe,
    onHit: report[name].onHit,
    onMiss: report[name].onMiss,
    onError,
    ttl,
    storage,
    references,

    // TODO use a custom policy serializer if any
    serialize ({ self, arg, info, ctx }) {
      // We need to cache only for the selected fields to support Federation
      // TODO detect if we really need to do this in most cases
      const fields = []
      for (let i = 0; i < info.fieldNodes.length; i++) {
        const node = info.fieldNodes[i]
        if (!node.selectionSet) {
          continue
        }
        for (let j = 0; j < node.selectionSet.selections.length; j++) {
          fields.push(node.selectionSet.selections[j].name.value)
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
  }, async function ({ self, arg, ctx, info }) {
    return originalFieldResolver(self, arg, ctx, info)
  })

  return async function (self, arg, ctx, info) {
    let result

    // dont use cache on mutation and subscriptions
    result = await getResultForMutationSubscription({ self, arg, ctx, info, originalFieldResolver, onError })

    // dont use cache on skip by policy or by general skip
    if (result === false) {
      result = await getResultIfSkipDefined({ self, arg, ctx, info, skip, policy, name, report, originalFieldResolver, onError })
    }

    // use cache to get the result
    if (result === false) {
      result = await getResultFromCache({ self, arg, ctx, info, cache, name, originalFieldResolver })
    }

    if (invalidate) {
      // Invalidates references and calls onError if fails
      await invalidation(invalidate, cache, name, self, arg, ctx, info, result, onError)
    }

    return result
  }
}

async function invalidation (invalidate, cache, name, self, arg, ctx, info, result, onError) {
  try {
    const references = await invalidate(self, arg, ctx, info, result)
    await cache.invalidate(name, references)
  } catch (err) {
    onError(err)
  }
}

async function getResultForMutationSubscription ({ self, arg, ctx, info, originalFieldResolver, onError }) {
  let result = false
  if (info.operation && (info.operation.operation === 'mutation' || info.operation.operation === 'subscription')) {
    try {
      result = await originalFieldResolver(self, arg, ctx, info)
    } catch (error) {
      onError(error)
      return null
    }
  }
  return result
}

async function getResultIfSkipDefined ({ self, arg, ctx, info, skip, policy, name, report, originalFieldResolver, onError }) {
  const result = false
  let isSkipped = false
  try {
    if ((skip && (await skip(self, arg, ctx, info))) ||
      (policy && policy.skip && (await policy.skip(self, arg, ctx, info)))) isSkipped = true
  } catch (error) {
    onError(error)
    return await originalFieldResolver(self, arg, ctx, info)
  }

  if (isSkipped) {
    try {
      report[name].onSkip()
      return await originalFieldResolver(self, arg, ctx, info)
    } catch (error) {
      onError(error)
      return null
    }
  }
  return result
}

async function getResultFromCache ({ self, arg, ctx, info, cache, name, originalFieldResolver }) {
  try {
    return await cache[name]({ self, arg, ctx, info })
  } catch (error) {
    return await originalFieldResolver(self, arg, ctx, info)
  }
}
