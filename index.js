'use strict'

const fp = require('fastify-plugin')
const LRUCache = require('mnemonist/lru-cache')
const stringify = require('safe-stable-stringify')

module.exports = fp(async function (app, { policy }) {
  // TODO support TTL
  const cache = new LRUCache(1000) // TODO make this configurable
  // TODO validate policy
  setupSchema(app.graphql.schema, policy, cache)
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
  return async function (a, b, c, d) {
    const key = prefix + '.' + fieldName + '.' + stringify(b)
    const cached = cache.get(key)
    if (cached) {
      return cached
    }
    const res = await originalFieldResolver.call(this, a, b, c, d)
    cache.set(key, res)
    return res
  }
}
