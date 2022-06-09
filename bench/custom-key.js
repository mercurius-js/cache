'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

const users = {
  a1: { name: 'Angus', lastName: 'Young' },
  b2: { name: 'Phil', lastName: 'Rudd' },
  c3: { name: 'Cliff', lastName: 'Williams' },
  d4: { name: 'Brian', lastName: 'Johnson' },
  e5: { name: 'Stevie', lastName: 'Young' }
}

const app = fastify()

const schema = `
  type Query {
    getUser (id: ID!): User
    getUsers (name: String, lastName: String): [User]

    getUserCustom (id: ID!): User
    getUsersCustom (name: String, lastName: String): [User]
  }

  type User {
    id: ID!
    name: String 
    lastName: String
  }
`

async function getUser (_, { id }) { return users[id] ? { id, ...users[id] } : null }
async function getUsers (_, { name, lastName }) {
  const id = Object.keys(users).find(key => {
    const user = users[key]
    if (name && user.name !== name) return false
    if (lastName && user.lastName !== lastName) return false
    return true
  })
  return id ? [{ id, ...users[id] }] : []
}

const resolvers = {
  Query: {
    getUser,
    getUsers,
    getUserCustom: getUser,
    getUsersCustom: getUsers
  }
}

app.register(mercurius, { schema, resolvers })

app.register(cache, {
  ttl: 60,
  policy: {
    Query: {
      getUser: true,
      getUsers: true,

      getUserCustom: { key ({ self, arg, info, ctx, fields }) { return `${arg.id}` } },
      getUsersCustom: { key ({ self, arg, info, ctx, fields }) { return `${arg.name || '*'},${arg.lastName || '*'}` } }
    }
  }
})

app.listen(3000)
