'use strict'

const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

async function main () {
  const app = Fastify({ logger: false })

  const users = {
    u1: {
      id: 'u1',
      name: 'John'
    },
    u2: {
      id: 'u2',
      name: 'Jane'
    }
  }

  const schema = `
    extend type Query {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }

    extend type Mutation {
      createUser(name: String!): User
      updateUser(id: ID!, name: String!): User
    }
  `

  const resolvers = {
    Query: {
      me: () => users.u1
    },
    User: {
      __resolveReference: (user) => users[user.id]
    },
    Mutation: {
      createUser: (_, args) => {
        const user = {
          id: `u${Object.keys(users).length + 1}`,
          name: args.name
        }
        users[user.id] = user
        return user
      },

      updateUser: (_, args) => {
        if (!users[args.id]) {
          throw new Error('User not found')
        }
        users[args.id] = args
        return args
      }
    }
  }

  await app.register(mercuriusFederationPlugin, {
    schema,
    resolvers,
    jit: 1
  })

  await app.listen({ port: 3001 })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
