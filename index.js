'use strict'

// TODO bin for redis.gc + args
// TODO examples: basic, redis, invalidation, references, gc, different storages/ttl per policy

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')
const createStorage = require('async-cache-dedupe/storage')
const { validateOpts } = require('./lib/validation')
const createReport = require('./lib/report')

module.exports = fp(async function (app, opts) {
  const { all, policy, ttl, skip, storage, onDedupe, onHit, onMiss, onSkip, logInterval, logReport } = validateOpts(app, opts)

  let cache = null
  let report = null

  app.graphql.cache = {
    refresh () {
      buildCache()
      setupSchema(app.graphql.schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, report)
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
    setupSchema(schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, report)
  })

  function buildCache () {
    cache = new Cache({
      ttl,
      storage: createStorage(storage.type, storage.options)
    })
    report = createReport({ app, all, policy, logInterval, logReport })
  }
}, {
  fastify: '^3.x',
  dependencies: ['mercurius']
})

function setupSchema (schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, report) {
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
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, report)
          }
        }
      }
    }
  }
  if (queryKeys.length) { throw new Error(`Query does not match schema: ${queryKeys}`) }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, report) {
  const name = prefix + '.' + fieldName

  onDedupe = onDedupe.bind(null, prefix, fieldName)
  onHit = onHit.bind(null, prefix, fieldName)
  onMiss = onMiss.bind(null, prefix, fieldName)
  onSkip = onSkip.bind(null, prefix, fieldName)

  report.wrap({ name, onDedupe, onHit, onMiss, onSkip })

  let ttl, storage, references, invalidate
  if (policy) {
    ttl = policy.ttl
    storage = policy.storage
    references = policy.references
    invalidate = policy.invalidate
  }

  if (storage) {
    storage = createStorage(storage.type, storage.options)
  }

  cache.define(name, {
    onDedupe: report[name].onDedupe,
    onHit: report[name].onHit,
    onMiss: report[name].onMiss,
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
      // TODO use a fast JSON stringify
      // TODO skip self too?
      return { self, arg, fields, extendKey }
    }
  }, async function ({ self, arg, ctx, info }) {
    return originalFieldResolver(self, arg, ctx, info)
  })

  return async function (self, arg, ctx, info) {
    let result
    try {
      // dont use cache on mutation
      // TODO dont cache also subscriptions
      if (info.operation && info.operation.operation === 'mutation') {
        result = await originalFieldResolver(self, arg, ctx, info)
      } else if (
        (skip && (await skip(self, arg, ctx, info))) ||
        (policy && policy.skip && (await policy.skip(self, arg, ctx, info)))
      ) {
        // dont use cache on skip by policy or by general skip
        report[name].onSkip()
        result = await originalFieldResolver(self, arg, ctx, info)
      } else {
        // use cache to get the result
        result = await cache[name]({ self, arg, ctx, info })
      }

      if (invalidate) {
        // note: invalidate is async but no await
        invalidation(invalidate, cache, name, self, arg, ctx, info, result)
      }
    } catch (err) {
      // TODO implement onError
      return originalFieldResolver(self, arg, ctx, info)
    }

    return result
  }
}

async function invalidation (invalidate, cache, name, self, arg, ctx, info, result) {
  try {
    const references = await invalidate(self, arg, ctx, info, result)
    await cache.invalidate(name, references)
  } catch (err) {
    // TODO implement onError
  }
}
