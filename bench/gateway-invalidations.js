'use strict'

const Fastify = require('fastify')
const mercuriusGateway = require('@mercuriusjs/gateway')
const cache = require('..')

async function main () {
  const app = Fastify({ logger: false })

  await app.register(mercuriusGateway, {
    gateway: {
      services: [
        {
          name: 'user',
          url: 'http://localhost:3001/graphql'
        },
        {
          name: 'post',
          url: 'http://localhost:3002/graphql'
        }
      ]
    },
    jit: 1
  })

  await app.register(cache, {
    ttl: 120,
    storage: {
      type: 'memory',
      options: {
        invalidation: true
      }
    },
    onError: (type, fieldName, err) => {
      console.log('Error', type, fieldName, err)
    },
    policy: {
      Query: {
        topPosts: {
          references: () => ['topPosts']
        },
        getPost: {
          references: (_, arg) => [`getPost:${arg.pid}`]
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

  await app.listen({ port: 3000 })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
