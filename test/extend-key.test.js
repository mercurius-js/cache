'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

test('cache per user using extendKey option', async ({ equal, same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async hello (source, args, { reply, user }) {
        return user ? `Hello ${user}` : '?'
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    context: async (req) => {
      return {
        user: req.query.user
      }
    }
  })

  let hits = 0
  let misses = 0
  app.register(cache, {
    ttl: 10,
    policy: {
      Query: {
        hello: {
          extendKey: function (source, args, context, info) {
            return context.user ? `user:${context.user}` : undefined
          }
        }
      }
    },
    onHit () { hits++ },
    onMiss () { misses++ }
  })

  for (let i = 0; i < 3; i++) {
    const query = '{ hello }'
    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: '?'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=alice',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello alice'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=bob',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello bob'
        }
      })
    }
  }

  equal(misses, 3)
  equal(hits, 6)
})

test('cache per user using remoteCahe and extendKey', async ({ equal, same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async hello (source, args, { reply, user }) {
        return user ? `Hello ${user}` : '?'
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    context: async (req) => {
      return {
        user: req.query.user
      }
    }
  })

  let hits = 0
  let misses = 0

  app.register(cache, {
    ttl: 10,
    policy: {
      Query: {
        hello: {
          extendKey: function (source, args, context, info) {
            return context.user ? `user:${context.user}` : undefined
          }
        }
      }
    },
    onHit () { hits++ },
    onMiss () { misses++ }
  })

  for (let i = 0; i < 3; i++) {
    const query = '{ hello }'
    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: '?'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=alice',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello alice'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=bob',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello bob'
        }
      })
    }
  }

  equal(misses, 3)
  equal(hits, 6)
})
