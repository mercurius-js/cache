'use strict'

const { setTimeout } = require('node:timers/promises')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

async function main () {
  const app = fastify({ logger: false })

  const schema = `
    type Query {
      slowValue(id: ID!): SlowValue!
    }

    type SlowValue {
      id: ID!
      value: String!
      computedAt: String!
    }
  `

  const resolvers = {
    Query: {
      async slowValue (_, { id }) {
        await setTimeout(100)
        return {
          id,
          value: `value:${id}`,
          computedAt: new Date().toISOString()
        }
      }
    }
  }

  await app.register(mercurius, {
    schema,
    resolvers,
    jit: 1
  })

  if (process.argv[2] !== undefined) {
    await app.register(cache, {
      ttl: Number(process.argv[2]),
      policy: {
        Query: {
          slowValue: true
        }
      }
    })
  }

  await app.listen({ port: 3000 })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
