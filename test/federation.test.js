'use strict'

const { test } = require('node:test')
const fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')
const cache = require('..')

const { request } = require('./helper')

test('cache __resolveReference on federated service', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type User @key(fields: "id") {
    id: ID!
    name: String
  }

  type Dog {
    name: String!
  }

  type Query {
    getDog: Dog
  }  
  `

  const resolvers = {
    User: {
      __resolveReference: async (source, args, context, info) => {
        return { id: source.id, name: `user #${source.id}` }
      }
    },
    Dog: {
      __resolveReference: async (source, args, context, info) => {
        return { name: 'Rocky' }
      },
      name: async (source, args, context, info) => {
        return 'Rocky'
      }
    },
    Query: {
      getDog: async (source, args, context, info) => {
        return { name: 'Lillo' }
      }
    }
  }

  app.register(mercuriusFederationPlugin, {
    schema,
    resolvers
  })

  let hits = 0
  let misses = 0

  app.register(cache, {
    ttl: 4242,
    onHit (type, name) { hits++ },
    onMiss (type, name) { misses++ },
    // it should use the cache for User.__resolveReference but not for Dog
    policy: {
      User: { __resolveReference: true },
      Dog: { name: true }
    }
  })

  let query = `query ($representations: [_Any!]!) {
    _entities(representations: $representations) {
      ... on User { id, name }
    }
  }`

  const variables = {
    representations: [
      {
        __typename: 'User',
        id: 123
      }
    ]
  }

  t.assert.deepStrictEqual(await request({ app, query, variables }),
    { data: { _entities: [{ id: '123', name: 'user #123' }] } })

  t.assert.deepStrictEqual(await request({ app, query, variables }),
    { data: { _entities: [{ id: '123', name: 'user #123' }] } })

  query = '{ getDog { name } }'

  t.assert.deepStrictEqual(await request({ app, query }),
    { data: { getDog: { name: 'Rocky' } } })

  t.assert.strictEqual(misses, 2)
  t.assert.strictEqual(hits, 1)
})
