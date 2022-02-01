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

app.register(cache, {
  ttl: 120, // 3 minutes
  options: {
    invalidation: true
  },
  onError: (err) => {
    console.log('Error', err)
  },
  policy: {
    Query: {
      topPosts: {
        references: () => {
          return ['topPosts']
        }
      },
      getPost: {
        references: (_, arg) => {
          return [`getPost:${arg.pid}`]
        }
      }
    },
    Mutation: {
      updatePostTitle: {
        invalidate (_, arg) {
          return [`getPost:${arg.pid}`, 'posts']
        }
      }
    }
  }
})

app.listen(3000)
