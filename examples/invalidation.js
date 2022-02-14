'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('mercurius-cache')

const app = fastify({ logger: true })

const schema = `
  type User {
    id: ID!
    name: String!
  }

  type Query {
    user(id: ID!): User
  }

  input UserInput {
    name: String!
  }

  type Mutation {
    updateUser (id: ID!, user: UserInput!): User!
  }
`

const resolvers = {
  Query: {
    user (_, { id }, { app }) {
      app.log.info(`requesting user with an id ${id}`)
      for (let i = 0; i < 10000000; i++) {
        // empty for a reason
      }
      return { id, name: `User ${id}` }
    }
  },
  Mutation: {
    updateUser (_, { id, user }, { app }) {
      app.log.info(`updating a user with an id ${id}`)
      for (let i = 0; i < 10000000; i++) {
        // empty for a reason
      }

      return { id, name: user.name }
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})

app.register(cache, {
  ttl: 10,
  storage: {
    type: 'memory',
    options: { client: app.redis, invalidation: true }
  },
  onHit (type, fieldName) {
    console.log(`hit ${type} ${fieldName}`)
  },
  onMiss (type, fieldName) {
    console.log(`miss ${type} ${fieldName}`)
  },
  policy: {
    Query: {
      user: {
        // references: the user by id
        references: (_request, _key, result) => {
          if (!result) {
            return
          }
          return [`user:${result.id}`]
        }
      }
    },
    Mutation: {
      updateUser: {
        // invalidate the user
        invalidate: (self, arg, _ctx, _info, _result) => [`user:${arg.id}`]
      }
    }
  }
})

app.listen(3000)
