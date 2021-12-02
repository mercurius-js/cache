'use strict'

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')
const { validateOpts } = require('./lib/validation')
const createReport = require('./lib/report')

module.exports = fp(async function (app, opts) {
  validateOpts(opts)

  // TODO doc drop option cacheSize
  // TODO doc storage now is {type, options}
  let { all, policy, ttl, cacheSize, skip, storage, onHit, onMiss, onSkip, logInterval, logReport } = opts

  onHit = onHit || noop
  onMiss = onMiss || noop
  onSkip = onSkip || noop

  let cache = null
  let report = null

  app.graphql.cache = {
    refresh () {
      buildCache()
      setupSchema(app.graphql.schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip, report)
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
    report.close()
  })

  // Add hook to regenerate the resolvers when the schema is refreshed
  app.graphql.addHook('onGatewayReplaceSchema', async (instance, schema) => {
    buildCache()
    setupSchema(schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip, report)
  })

  function buildCache () {
    cache = new Cache({
      ttl,
      cacheSize
    })
    report = createReport({ app, all, policy, logInterval, logReport })
  }
}, {
  fastify: '^3.x',
  dependencies: ['mercurius']
})

function setupSchema (schema, policy, all, cache, skip, storage, onHit, onMiss, onSkip, report) {
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
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver, policy, skip, storage, onHit, onMiss, onSkip, report)
          }
        }
      }
    }
  }
  if (queryKeys.length) { throw new Error(`Query does not match schema: ${queryKeys}`) }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver, policy, skip, storage, onHit, onMiss, onSkip, report) {
  const name = prefix + '.' + fieldName
  onHit = onHit.bind(null, prefix, fieldName)
  onMiss = onMiss.bind(null, prefix, fieldName)
  onSkip = onSkip.bind(null, prefix, fieldName)

  report.wrap({ name, onHit, onMiss, onSkip })

  cache.define(name, {
    onHit: report[name].onHit,
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
        report[name].onHit()
        return val
      }
    }

    report[name].onMiss()
    const res = await originalFieldResolver(self, arg, ctx, info)
    if (storage) {
      await storage.set(name + '~' + key, res)
    }
    return res
  })
  return async function (self, arg, ctx, info) {
    // TODO dont cache also subscriptions
    if (info.operation && info.operation.operation === 'mutation') {
      return originalFieldResolver(self, arg, ctx, info)
    }

    if (
      (skip && (await skip(self, arg, ctx, info))) ||
      (policy && policy.skip && (await policy.skip(self, arg, ctx, info)))
    ) {
      report[name].onSkip()
      return originalFieldResolver(self, arg, ctx, info)
    }
    return cache[name]({ self, arg, ctx, info })
  }
}

function noop () { }
