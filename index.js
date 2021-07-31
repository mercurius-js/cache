'use strict'

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')

function initializeCache (app, ttl, cacheSize) {
  const cache = new Cache({
    ttl,
    cacheSize
  })

  app.mercuriusCache = cache
}

module.exports = fp(async function (app, { policy, ttl, cacheSize }) {
  if (typeof policy !== 'object') {
    throw new Error('policy must be an object')
  }
  app.decorate('mercuriusCache', null)

  // TODO validate merciuris is already registered

  initializeCache(app, ttl, cacheSize)

  // TODO validate policy
  setupSchema(app.graphql.schema, policy, app.mercuriusCache)

  // Add hook to regenerate the resolvers when the schema is refreshed
  app.graphql.addHook('onGatewayReplaceSchema', async (instance, schema) => {
    initializeCache(app, ttl, cacheSize)
    setupSchema(schema, policy, app.mercuriusCache)
  })
})

function setupSchema (schema, policy, cache) {
  const schemaTypeMap = schema.getTypeMap()
  for (const schemaType of Object.values(schemaTypeMap)) {
    const fieldPolicy = policy[schemaType]
    if (!fieldPolicy) {
      continue
    }

    // Handle fields on schema type
    if (typeof schemaType.getFields === 'function') {
      for (const [fieldName, field] of Object.entries(schemaType.getFields())) {
        if (fieldPolicy[fieldName]) {
          // Override resolvers for caching purposes
          if (typeof field.resolve === 'function') {
            const originalFieldResolver = field.resolve
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver)
          }
        }
      }
    }
  }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver) {
  const name = prefix + '.' + fieldName
  cache.define(name, {
    serialize ({ self, arg, info }) {
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

      // We must skip ctx and info as they are not easy to serialize
      return { self, arg, fields }
    }
  }, async function ({ self, arg, ctx, info }) {
    const res = await originalFieldResolver(self, arg, ctx, info)
    return res
  })
  return function (self, arg, ctx, info) {
    return cache[name]({ self, arg, ctx, info })
  }
}
