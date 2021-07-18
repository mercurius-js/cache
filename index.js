'use strict'

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')

module.exports = fp(async function (app, { policy, ttl, cacheSize }) {
  const cache = new Cache({
    ttl,
    cacheSize
  })
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
  const name = prefix + '.' + fieldName
  cache.define(name, async function (arg) {
    const res = await originalFieldResolver(null, arg, null, null)
    return res
  })
  return function (a, b, c, d) {
    return cache[name](b)
  }
}
