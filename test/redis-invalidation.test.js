'use strict'

const { test, before, beforeEach, teardown } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')
const Redis = require('ioredis')

const redisClient = new Redis()
const defaultPost = { method: 'POST', url: '/graphql' }

before(async () => {
  await redisClient.flushall()
})

teardown(async () => {
  await redisClient.quit()
})

beforeEach(async () => {
  await redisClient.flushall()
})

test('should remove storage keys by references', async ({
  fail,
  equal,
  plan,
  teardown
}) => {
  plan(7)

  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      get (id: Int): String
      find (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      },
      async find (_, { id }) {
        return 'find ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  let miss = 0
  app.register(cache, {
    ttl: 100,
    storage: {
      type: 'redis',
      options: { client: redisClient, invalidation: true }
    },
    onHit (type, name) {
      if (name !== 'find') fail()
    },
    onMiss (type, name) {
      ++miss
    },
    policy: {
      Query: {
        get: {
          references: async ({ arg }) => [`get:${arg.id}`]
        },
        find: true
      },
      Mutation: {
        set: {
          invalidate: async (self, arg) => [`get:${arg.id}`]
        }
      }
    }
  })
  // Cache the follwoing
  await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
  equal(miss, 1)
  await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
  equal(miss, 2)
  await app.inject({ ...defaultPost, body: { query: '{ find(id: 11) }' } })
  equal(miss, 3)
  // Request a mutation
  await app.inject({
    ...defaultPost,
    body: { query: 'mutation { set(id: 11) }' }
  })
  equal(miss, 3)
  // 'get' should not be cached
  await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
  equal(miss, 4)
  await app.inject({ ...defaultPost, body: { query: '{ find(id: 11) }' } })
  equal(miss, 4)
  await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
  equal(miss, 5)
})
