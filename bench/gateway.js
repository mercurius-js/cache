'use strict'

const Fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

const app = Fastify()

app.register(mercurius, {
  gateway: {
    services: [{
      name: 'user',
      url: 'http://localhost:3001/graphql'
    }, {
      name: 'post',
      url: 'http://localhost:3002/graphql'
    }]
  },
  graphiql: true,
  jit: 1
})

if (process.argv[2]) {
  app.register(cache, {
    all: true,
    ttl: Number(process.argv[2])
  })
}

app.listen(3000)
