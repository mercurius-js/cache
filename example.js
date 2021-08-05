'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('.')

const app = fastify({ logger: true })

const schema = `
  type Query {
    add(x: Int, y: Int): Int
    hello: String
  }
`

const resolvers = {
  Query: {
    async add (_, { x, y }, { reply }) {
      reply.log.info('add called')
      for (let i = 0; i < 10000000; i++) {
        // empty for a reason
      }
      return x + y
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})

app.register(cache, {
  // all: true
  policy: {
    Query: {
      add: true
    }
  }
})

app.listen(3000)

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
