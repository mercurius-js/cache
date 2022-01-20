'use strict'

const { test, teardown, beforeEach } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')
const Redis = require('ioredis')
const { request } = require('./helper')

const redisClient = new Redis()

teardown(async () => {
  await redisClient.quit()
})

beforeEach(async () => {
  await redisClient.flushall()
})

test('redis invalidation', async () => {
  const setupServer = ({ onMiss, onHit, invalidate, onError, tap }) => {
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
    const app = fastify()
    tap.teardown(app.close.bind(app))
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss,
      onHit,
      onError,
      policy: {
        Query: {
          get: {
            references: ({ arg }) => [`get:${arg.id}`, 'gets']
          },
          search: {
            references: ({ arg }) => [`search:${arg.id}`]
          }
        },
        Mutation: {
          set: {
            invalidate: invalidate || ((_, arg) => [`get:${arg.id}`, 'gets'])
          }
        }
      }
    })
    return app
  }

  test('should remove storage keys by references', async tap => {
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      invalidate: (_, arg) => [`get:${arg.id}`],
      tap
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    tap.equal(miss, 3)
    // 'get:11' should not be present in cache anymore
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 4)
  })

  test('should not remove storage key by not existing reference', async tap => {
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      invalidate: () => ['foo'],
      tap
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    tap.equal(miss, 3)
    // 'get:11' should be still in cache
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 3)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 3)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 3)
  })

  test('should invalidate more than one reference at once', async tap => {
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      tap
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    tap.equal(miss, 3)
    // All 'get' should not be present in cache anymore
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(miss, 5)
  })

  test('should remove storage keys by references, but not the ones still alive', async tap => {
    // Setup Fastify and Mercurius
    let failHit = false
    const app = setupServer({
      onHit () {
        if (failHit) tap.fail()
      },
      tap
    })
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    tap.equal(
      await redisClient.get((await redisClient.smembers('r:get:11'))[0]),
      '"get 11"'
    )
    await request({ app, query: '{ get(id: 12) }' })
    tap.equal(
      await redisClient.get((await redisClient.smembers('r:get:12'))[0]),
      '"get 12"'
    )
    await request({ app, query: '{ search(id: 11) }' })
    tap.equal(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // Request a mutation, invalidate 'gets'
    await request({ app, query: 'mutation { set(id: 11) }' })
    // Check the references of 'searchs', should still be there
    tap.equal(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // 'get:11' should not be present in cache anymore,
    failHit = true
    // should trigger onMiss and not onHit
    await request({ app, query: '{ get(id: 11) }' })
  })

  test('should not throw on invalidation error', async tap => {
    tap.plan(3)
    // Setup Fastify and Mercurius
    const app = setupServer({
      invalidate () {
        throw new Error('Kaboom')
      },
      onError (type, fieldName, error) {
        tap.equal(type, 'Mutation')
        tap.equal(fieldName, 'set')
        tap.equal(error.message, 'Kaboom')
      },
      tap
    })
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    await request({ app, query: 'mutation { set(id: 11) }' })
  })
})
