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

    invalidate (references, storage) {
      return cache.invalidateAll(references, storage)
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
  fastify: '4.x',
  dependencies: ['mercurius']
})

function setupSchema (schema, policy, all, cache, skip, onDedupe, onHit, onMiss, onSkip, onError, report) {
  const schemaTypeMap = schema.getTypeMap()
  // validate policies vs schema
  const policies = !all && policy
    ? Object.keys(policy).reduce((o, key) => {
      o.push(...Object.keys(policy[key]).map(fieldName => `${key}.${fieldName}`))
      return o
    }, [])
    : []

  for (const schemaType of Object.values(schemaTypeMap)) {
    const fieldPolicy = all || policy[schemaType.name]
    if (!fieldPolicy) {
      continue
    }

    // Handle fields on schema type
    if (typeof schemaType.getFields === 'function') {
      for (const [fieldName, field] of Object.entries(schemaType.getFields())) {
        const policy = getPolicyOptions(fieldPolicy, fieldName)
        if (all || policy) {
          // Override resolvers for caching purposes
          if (typeof field.resolve === 'function') {
            const originalFieldResolver = field.resolve
            if (!all) {
              policies.splice(policies.indexOf(`${schemaType.name}.${fieldName}`), 1)
            }
            field.resolve = makeCachedResolver(schemaType.name, fieldName, cache, originalFieldResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, onError, report)
          }
        }
      }
    }

    if (typeof schemaType.resolveReference === 'function') {
      const resolver = '__resolveReference'
      const policy = getPolicyOptions(fieldPolicy, '__resolveReference')
      if (policy) {
        // Override reference resolver for caching purposes
        const originalResolver = schemaType.resolveReference
        policies.splice(policies.indexOf(`${schemaType.name}.${resolver}`), 1)
        schemaType.resolveReference = makeCachedResolver(schemaType.name, resolver, cache, originalResolver, policy, skip, onDedupe, onHit, onMiss, onSkip, onError, report)
      }
    }
  }

  if (!all && policies.length) {
    throw new Error(`policies does not match schema: ${policies.join(', ')}, it must be a resolver or a loader`)
  }
}

function getPolicyOptions (fieldPolicy, fieldName) {
  if (!fieldPolicy[fieldName]) {
    return
  }

  if (fieldPolicy[fieldName].__options) {
    return fieldPolicy[fieldName].__options
  }

  return fieldPolicy[fieldName]
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
          if (node.selectionSet.selections[j].kind === 'InlineFragment') {
            fields.push(...node.selectionSet.selections[j].selectionSet.selections.map(s => s.name.value))
          } else { // kind = 'Field'
            fields.push(node.selectionSet.selections[j].name.value)
          }
        }
      }
      fields.sort()

      // We must skip ctx and info as they are not easy to serialize
      const id = { self, arg, fields }

      if (!policy) {
        return id
      }

      // use a custom policy serializer if any
      if (policy.key) {
        return policy.key({ self, arg, info, ctx, fields })
      } else if (policy.extendKey) {
        const append = policy.extendKey(self, arg, ctx, info)
        if (append) {
          id.extendKey = '~' + append
        }
      }

      return id
    }
  }, async function ({ self, arg, ctx, info }) {
    return originalFieldResolver(self, arg, ctx, info)
  })

  return async function (self, arg, ctx, info) {
    let result
    let resolved

    // dont use cache on mutation and subscriptions
    [result, resolved] = await getResultForMutationSubscription({ self, arg, ctx, info, originalFieldResolver })

    // dont use cache on skip by policy or by general skip
    if (!resolved) {
      [result, resolved] = await getResultIfSkipDefined({ self, arg, ctx, info, skip, policy, name, report, originalFieldResolver, onError })
    }

    // use cache to get the result
    if (!resolved) {
      // in case of che original resolver will throw, the error will be forwarded
      // onError is already been called by cache events binding
      result = await cache[name]({ self, arg, ctx, info })
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

async function getResultForMutationSubscription ({ self, arg, ctx, info, originalFieldResolver }) {
  const resolved = false
  let result = null
  if (info.operation && (info.operation.operation === 'mutation' || info.operation.operation === 'subscription')) {
    result = await originalFieldResolver(self, arg, ctx, info)
    return [result, true]
  }
  return [result, resolved]
}

async function getResultIfSkipDefined ({ self, arg, ctx, info, skip, policy, name, report, originalFieldResolver, onError }) {
  const resolved = false
  let result = null
  let isSkipped = false
  try {
    isSkipped = ((skip && (await skip(self, arg, ctx, info))) ||
      (policy && policy.skip && (await policy.skip(self, arg, ctx, info))))
  } catch (error) {
    onError(error)
    result = await originalFieldResolver(self, arg, ctx, info)
    return [result, true]
  }

  if (isSkipped) {
    report[name].onSkip()
    result = await originalFieldResolver(self, arg, ctx, info)
    return [result, true]
  }
  return [result, resolved]
}
