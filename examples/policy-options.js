'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('mercurius-cache')

const app = fastify({ logger: true })

function slowdown () {
  for (let i = 0; i < 10000000; i++) {
    // empty for a reason
  }
}

const schema = `
  type Query {
    add(x: Int, y: Int): Int
    sub(x: Int, y: Int): Int
    multiply(x: Int, y: Int): Int
    divide(x: Int, y: Int): Int
  }
`

const resolvers = {
  Query: {
    async add (_, { x, y }, { reply }) {
      reply.log.info('add called')
      slowdown()
      return x + y
    },
    async sub (_, { x, y }, { reply }) {
      reply.log.info('sub called')
      slowdown()
      return x - y
    },
    async multiply (_, { x, y }, { reply }) {
      reply.log.info('multiply called')
      slowdown()
      return x * y
    },
    async divide (_, { x, y }, { reply }) {
      reply.log.info('divide called')
      slowdown()
      return Math.floor(x / y)
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})

app.register(cache, {
  ttl: 10,
  storage: { type: 'memory', options: { size: 10 } },
  policy: {
    Query: {
      add: { ttl: 1, storage: { type: 'memory', options: { size: 1 } } },
      sub: { ttl: 2, storage: { type: 'memory', options: { size: 2 } } },
      multiply: { ttl: 3, storage: { type: 'memory', options: { size: 3 } } },
      divide: { ttl: 4, storage: { type: 'memory', options: { size: 4 } } }
    }
  }
})

app.listen(3000)

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ sub(x: 2, y: 2) }" }' localhost:3000/graphql
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ multiply(x: 2, y: 2) }" }' localhost:3000/graphql
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ divide(x: 2, y: 2) }" }' localhost:3000/graphql
