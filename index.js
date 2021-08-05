'use strict'

const fp = require('fastify-plugin')
const { Cache } = require('async-cache-dedupe')

module.exports = fp(async function (app, { all, policy, ttl, cacheSize, skip }) {
  if (typeof policy !== 'object' && !all) {
    throw new Error('policy must be an object')
  } else if (all && policy) {
    throw new Error('policy and all options are exclusive')
  }

  // TODO validate mercurius is already registered
  // TODO validate policy

  let cache = null

  app.graphql.cache = {
    refresh () {
      buildCache()
      setupSchema(app.graphql.schema, policy, all, cache, skip)
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
    setupSchema(schema, policy, all, cache, skip)
  })

  function buildCache () {
    cache = new Cache({
      ttl,
      cacheSize
    })
  }
})

function setupSchema (schema, policy, all, cache, skip) {
  const schemaTypeMap = schema.getTypeMap()
  for (const schemaType of Object.values(schemaTypeMap)) {
    const fieldPolicy = all || policy[schemaType]
    if (!fieldPolicy) {
      continue
    }

    // Handle fields on schema type
    if (typeof schemaType.getFields === 'function') {
      for (const [fieldName, field] of Object.entries(schemaType.getFields())) {
        if (all || fieldPolicy[fieldName]) {
          // Override resolvers for caching purposes
          if (typeof field.resolve === 'function') {
            const originalFieldResolver = field.resolve
            field.resolve = makeCachedResolver(schemaType.toString(), fieldName, cache, originalFieldResolver, skip)
          }
        }
      }
    }
  }
}

function makeCachedResolver (prefix, fieldName, cache, originalFieldResolver, skip) {
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
    return originalFieldResolver(self, arg, ctx, info)
  })
  return async function (self, arg, ctx, info) {
    if (skip && await skip(ctx)) {
      return originalFieldResolver(self, arg, ctx, info)
    }
    return cache[name]({ self, arg, ctx, info })
  }
}
