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

  if (process.argv[2] !== undefined) {
    await app.register(cache, {
      all: true,
      ttl: Number(process.argv[2])
    })
  }

  await app.listen({ port: 3000 })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
