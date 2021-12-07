'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('../')

// TODO update

const app = fastify({ logger: true })

const schema = `
  type Query {
    welcome: String
  }
`

const resolvers = {
  Query: {
    async welcome (source, args, { reply, user }) {
      reply.log.info(`welcome for ${user}`)
      for (let i = 0; i < 10000000; i++) {
        // empty for a reason
      }
      return user ? `Welcome ${user}` : 'Hello'
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

app.register(cache, {
  // all: true
  policy: {
    Query: {
      welcome: {
        extendKey: function (source, args, context, info) {
          return context.user ? `user:${context.user}` : undefined
        }
      }
    }
  },
  onHit: function (type, fieldName) {
    app.log.info({ msg: 'hit from cache', type, fieldName })
  },
  onMiss: function (type, fieldName) {
    app.log.info({ msg: 'miss from cache', type, fieldName })
  }
})

app.listen(3000)

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ welcome }" }' localhost:3000/graphql?user=alice
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ welcome }" }' localhost:3000/graphql?user=bob
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ welcome }" }' localhost:3000/graphql
