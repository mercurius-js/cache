'use strict'

const t = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const { GraphQLScalarType, Kind } = require('graphql')
const GraphQLJSON = require('graphql-type-json')
const Redis = require('ioredis')
const cache = require('..')

const { request } = require('./helper')

const redisClient = new Redis()

t.teardown(async () => {
  await redisClient.quit()
})

const storages = [
  { type: 'memory' },
  { type: 'redis', options: { client: redisClient, invalidation: true } }
]

t.test('works with custom scalar type', async t => {
  t.beforeEach(async () => {
    await redisClient.flushall()
  })

  for (const storage of storages) {
    t.test(`with ${storage.type} storage`, async t => {
      const app = fastify()
      t.teardown(app.close.bind(app))

      const dateScalar = new GraphQLScalarType({
        name: 'Date',
        description: 'Date custom scalar type',
        parseValue: value => value instanceof Date ? value : new Date(value),
        serialize: value => value instanceof Date ? value : new Date(value),
        parseLiteral: ast => ast.kind === Kind.INT ? new Date(+ast.value) : null
      })

      const schema = `
      scalar Date

      type Event {
        id: ID!
        date: Date!
      }
    
      type Query {
        events: [Event!]
      }
    `

      const date = '2023-01-19T08:25:38.258Z'
      const id = 'abc123'
      const events = [
        { id, date: new Date(date) }
      ]

      const resolvers = {
        Date: dateScalar,
        Query: { async events () { return events } }
      }

      app.register(mercurius, { schema, resolvers })

      let hits = 0
      let misses = 0

      app.register(cache, {
        ttl: 999,
        all: true,
        storage,
        onHit () { hits++ },
        onMiss () { misses++ }
      })

      const query = '{ events { id, date } }'

      {
        const result = await request({ app, query })
        t.same(result, { data: { events: [{ id, date }] } })
      }

      {
        const result = await request({ app, query })
        t.same(result, { data: { events: [{ id, date }] } })
      }

      t.equal(hits, 1)
      t.equal(misses, 1)
    })
  }
})

t.test('works with 3rd party scalar type', async t => {
  t.beforeEach(async () => {
    await redisClient.flushall()
  })

  for (const storage of storages) {
    t.test(`with ${storage.type} storage`, async t => {
      const app = fastify()
      t.teardown(app.close.bind(app))

      const schema = `
      scalar JSON

      type Event {
        address: JSON
      }
    
      type Query {
        events: [Event]
      }
      `

      const events = [
        { address: { } },
        { address: { street: '15th Avenue', zip: '987' } }
      ]

      const resolvers = {
        JSON: GraphQLJSON,
        Query: { async events () { return events } }
      }

      app.register(mercurius, { schema, resolvers })

      let hits = 0
      let misses = 0

      app.register(cache, {
        ttl: 999,
        all: true,
        storage,
        onHit () { hits++ },
        onMiss () { misses++ }
      })

      const query = '{ events { address } }'

      {
        const result = await request({ app, query })
        t.same(result, { data: { events } })
      }

      {
        const result = await request({ app, query })
        t.same(result, { data: { events } })
      }

      t.equal(hits, 1)
      t.equal(misses, 1)
    })
  }
})
