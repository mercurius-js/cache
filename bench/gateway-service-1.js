'use strict'

const Fastify = require('fastify')
const mercurius = require('mercurius')

const app = Fastify()

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
  type Query @extends {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
  }

  type Mutation @extends {
    createUser(name: String!): User
    updateUser(id: ID!, name: String!): User
  }
`

const resolvers = {
  Query: {
    me: (root, args, context, info) => {
      return users.u1
    }
  },
  User: {
    __resolveReference: (user, args, context, info) => {
      return users[user.id]
    }
  },
  Mutation: {
    createUser: (root, args, context, info) => {
      const user = {
        id: `u${Object.keys(users).length + 1}`,
        name: args.name
      }
      users[user.id] = user
      return user
    },

    updateUser: (root, args, context, info) => {
      if (!users[args.id]) {
        throw new Error('User not found')
      }
      users[args.id] = args
      return args
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers,
  federationMetadata: true,
  graphiql: false,
  jit: 1
})

app.listen(3001)
