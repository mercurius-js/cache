'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const redis = require('fastify-redis')
const fp = require('fastify-plugin')
const cache = require('mercurius-cache')

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
    },
    async hello () {
      return 'world'
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})

app.register(redis)

app.register(fp(async app => {
  app.register(cache, {
    ttl: 60,
    policy: {
      Query: {
        add: true,
        hello: true
      }
    },
    storage: {
      type: 'redis',
      options: {
        client: app.redis
      }
    },
    onHit: function (type, fieldName) {
      app.log.info({ msg: 'hit from cache', type, fieldName })
    },
    onMiss: function (type, fieldName) {
      app.log.info({ msg: 'miss from cache', type, fieldName })
    }
  }, { dependencies: ['fastify-redis'] })
}))

app.listen({ port: 3000 })

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
