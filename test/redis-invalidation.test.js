'use strict'

const { test, before, teardown, beforeEach } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')
const Redis = require('ioredis')
const { request } = require('./helper')

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
  const schema = `
    type Query {
      get (id: Int): String
      search (id: Int): String
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
    // Setup Fastify and Mercurius
    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
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
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.equal(miss, 3)
    // 'get:11' should not be cached
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 4)
  })

  test('should not remove storage key by not existing reference', async t => {
    t.plan(7)
    // Setup Fastify and Mercurius
    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
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
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.equal(miss, 3)
    // 'get:11' should be cached
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 3)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 3)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 3)
  })

  test('should invalidate more than one reference at once', async t => {
    t.plan(7)
    // Setup Fastify and Mercurius
    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
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
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.equal(miss, 3)
    // 'get' should not be cached
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(miss, 5)
  })

  test('should remove storage keys by references, but not the ones still alive', async t => {
    t.plan(4)
    // Setup Fastify and Mercurius
    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
    let failHit = false
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onHit () {
        if (failHit) t.fail()
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
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    t.equal(
      await redisClient.get((await redisClient.smembers('r:get:11'))[0]),
      '"get 11"'
    )
    await request({ app, query: '{ get(id: 12) }' })
    t.equal(
      await redisClient.get((await redisClient.smembers('r:get:12'))[0]),
      '"get 12"'
    )
    await request({ app, query: '{ search(id: 11) }' })
    t.equal(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // Request a mutation, invalidate 'gets'
    await request({ app, query: 'mutation { set(id: 11) }' })
    // Check the references of 'searchs', should still be there
    t.equal(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // This should not be cached, should enter miss and not hit
    failHit = true
    await request({ app, query: '{ get(id: 11) }' })
  })

  test('should not throw on invalidation error', async t => {
    t.plan(3)
    // Setup Fastify and Mercurius
    const app = fastify()
    t.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onError (type, fieldName, error) {
        t.equal(type, 'Mutation')
        t.equal(fieldName, 'set')
        t.equal(error.message, 'Kaboom')
      },
      policy: {
        Query: {
          get: {
            references: async ({ arg }) => [`get:${arg.id}`, 'gets']
          }
        },
        Mutation: {
          set: {
            invalidate: async () => {
              throw new Error('Kaboom')
            }
          }
        }
      }
    })
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    try {
      await request({ app, query: 'mutation { set(id: 11) }' })
    } catch (e) {
      t.fail()
    }
    // t.doesNotThrow(() => request({ app, query: 'mutation { set(id: 11) }' }))
  })
})
