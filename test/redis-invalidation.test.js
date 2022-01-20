'use strict'

const { test, before, teardown, beforeEach } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')
const Redis = require('ioredis')

const redisClient = new Redis()

before(async () => {
  await redisClient.flushall()
})

teardown(async () => {
  await redisClient.quit()
})

beforeEach(async () => {
  await redisClient.flushall()
})

test('redis invalidation', async () => {
  const defaultPost = { method: 'POST', url: '/graphql' }
  const defaultSchema = `
    type Query {
      get (id: Int): String
      search (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `
  const defaultResolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      },
      async search (_, { id }) {
        return 'search ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  test('should remove storage keys by references', async t => {
    t.plan(7)

    const app = fastify()
    t.teardown(app.close.bind(app))

    app.register(mercurius, {
      schema: defaultSchema,
      resolvers: defaultResolvers
    })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss () {
        ++miss
      },
      policy: {
        Query: {
          get: {
            references: async ({ arg }) => [`get:${arg.id}`]
          },
          search: true
        },
        Mutation: {
          set: {
            invalidate: async (_, arg) => [`get:${arg.id}`]
          }
        }
      }
    })
    // Cache the follwoing
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 1)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 2)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 3)
    // Request a mutation
    await app.inject({
      ...defaultPost,
      body: { query: 'mutation { set(id: 11) }' }
    })
    t.equal(miss, 3)
    // 'get:11' should not be cached
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 4)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 4)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 4)
  })

  test('should not remove storage key by not existing reference', async t => {
    t.plan(7)

    const app = fastify()
    t.teardown(app.close.bind(app))

    app.register(mercurius, {
      schema: defaultSchema,
      resolvers: defaultResolvers
    })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss () {
        ++miss
      },
      policy: {
        Query: {
          get: {
            references: async ({ arg }) => [`get:${arg.id}`]
          },
          search: true
        },
        Mutation: {
          set: {
            invalidate: async () => ['foo']
          }
        }
      }
    })
    // Cache the follwoing
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 1)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 2)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 3)
    // Request a mutation
    await app.inject({
      ...defaultPost,
      body: { query: 'mutation { set(id: 11) }' }
    })
    t.equal(miss, 3)
    // 'get:11' should be cached
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 3)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 3)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 3)
  })

  test('should invalidate more than one reference at once', async t => {
    t.plan(7)

    const app = fastify()
    t.teardown(app.close.bind(app))

    app.register(mercurius, {
      schema: defaultSchema,
      resolvers: defaultResolvers
    })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss () {
        ++miss
      },
      policy: {
        Query: {
          get: {
            references: async ({ arg }) => [`get:${arg.id}`, 'gets']
          },
          search: true
        },
        Mutation: {
          set: {
            invalidate: async (_, arg) => [`get:${arg.id}`, 'gets']
          }
        }
      }
    })
    // Cache the follwoing
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 1)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 2)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 3)
    // Request a mutation
    await app.inject({
      ...defaultPost,
      body: { query: 'mutation { set(id: 11) }' }
    })
    t.equal(miss, 3)
    // 'get' should not be cached
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    t.equal(miss, 4)
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })
    t.equal(miss, 4)
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    t.equal(miss, 5)
  })

  test('should remove storage keys by references, but not the ones still alive', async t => {
    t.plan(2)

    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, {
      schema: defaultSchema,
      resolvers: defaultResolvers
    })

    app.register(cache, {
      ttl: 1000,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      policy: {
        Query: {
          get: {
            references: async ({ arg }) => [`get:${arg.id}`, 'gets']
          },
          search: {
            references: async ({ arg }) => [`search:${arg.id}`, 'searchs']
          }
        },
        Mutation: {
          set: {
            invalidate: async () => ['gets']
          }
        }
      }
    })
    // Cache the follwoing
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 11) }' } })
    await app.inject({ ...defaultPost, body: { query: '{ get(id: 12) }' } })
    await app.inject({ ...defaultPost, body: { query: '{ search(id: 11) }' } })

    // Request a mutation, invalidate 'gets'
    await app.inject({
      ...defaultPost,
      body: { query: 'mutation { set(id: 11) }' }
    })

    // Check the references of 'searchs'
    const results = await redisClient.smembers('r:searchs')
    t.equal(results.length, 1)
    // Check the content cached
    t.equal(await redisClient.get(results[0]), '"search 11"')
  })
})
