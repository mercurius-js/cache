'use strict'

const { test, before, teardown, beforeEach } = require('tap')
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

test('redis invalidation', async () => {
  test('should remove storage keys by references', async t => {
    t.plan(7)

    const app = fastify()
    t.teardown(app.close.bind(app))

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

    app.register(mercurius, { schema, resolvers })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss (type, name) {
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
            invalidate: async (self, arg) => [`get:${arg.id}`]
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

    app.register(mercurius, { schema, resolvers })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss (type, name) {
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
            invalidate: async (self, arg) => ['foo']
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

    app.register(mercurius, { schema, resolvers })

    let miss = 0
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss (type, name) {
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
            invalidate: async (self, arg) => [`get:${arg.id}`, 'gets']
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
})
