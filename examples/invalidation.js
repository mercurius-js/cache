'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const redis = require('fastify-redis')
const fp = require('fastify-plugin')
const cache = require('mercurius-cache')

async function main () {
  const app = fastify({ logger: true })

  const schema = `
  type Country {
    name: String
  }

  type User {
    id: ID!
    name: String!
  }

  type Query {
    user(id: ID!): User
    countries: [Country]
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
        return { id, name: `User ${id}` }
      },
      countries (_, __, { app }) {
        app.log.info('requesting countries')
        return [{ name: 'Ireland' }, { name: 'Italy' }]
      }
    },
    Mutation: {
      updateUser (_, { id, user }, { app }) {
        app.log.info(`updating a user with an id ${id}`)
        return { id, name: user.name }
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
      ttl: 10,
      // default storage is redis
      storage: {
        type: 'redis',
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
          },
          // since countries rarely change, we can cache them for a very long time
          // and since their size is small, it's convenient to cache them in memory
          countries: {
            ttl: 86400, // 1 day
            // don't really need invalidation, just as example
            storage: { type: 'memory', options: { invalidation: true } },
            references: () => ['countries']
          }
        },
        Mutation: {
          updateUser: {
            // invalidate the user
            invalidate: (self, arg, _ctx, _info, _result) => [`user:${arg.id}`]
          }
        }
      }
    }, { dependencies: ['fastify-redis'] })
  }))

  await app.listen(3000)

  // manual invalidation

  // wildcard
  app.graphql.cache.invalidate('user:*')

  // with a reference
  app.graphql.cache.invalidate('user:1')

  // with an array of references
  app.graphql.cache.invalidate(['user:1', 'user:2'])

  // using a specific storage
  // note "countries" uses a different storage from the default one
  // so need to specify it, otherwise it will invalidate on the default storage
  app.graphql.cache.invalidate('countries', 'Query.countries')
}

main()
