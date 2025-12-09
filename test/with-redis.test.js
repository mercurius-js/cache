'use strict'

const { test, describe, beforeEach } = require('node:test')
const fastify = require('fastify')
const mercurius = require('mercurius')
const Redis = require('ioredis')
const cache = require('..')
const { request } = require('./helper')

const redisClient = new Redis()

test.after(async () => {
  await redisClient.quit()
})

test.beforeEach(async () => {
  await redisClient.flushall()
})

describe('redis invalidation', async () => {
  const setupServer = ({ onMiss, onHit, invalidate, onError, t }) => {
    const schema = `
      type Query {
        get (id: Int): String
        search (id: Int): String
      }
      type Mutation {
        set (id: Int): String
      }
    `
    const resolvers = {
      Query: {
        async get (_, { id }) {
          return 'get ' + id
        },
        async search (_, { id }) {
          return 'search ' + id
        }
      },
      Mutation: {
        async set (_, { id }) {
          return 'set ' + id
        }
      }
    }
    const app = fastify()
    t.after(() => app.close())
    app.register(mercurius, { schema, resolvers })
    // Setup Cache
    app.register(cache, {
      ttl: 100,
      storage: {
        type: 'redis',
        options: { client: redisClient, invalidation: true }
      },
      onMiss,
      onHit,
      onError,
      policy: {
        Query: {
          get: {
            references: ({ arg }) => [`get:${arg.id}`, 'gets']
          },
          search: {
            references: ({ arg }) => [`search:${arg.id}`]
          }
        },
        Mutation: {
          set: {
            invalidate: invalidate || ((_, arg) => [`get:${arg.id}`, 'gets'])
          }
        }
      }
    })
    return app
  }

  await test('should remove storage keys by references', async t => {
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      invalidate: (_, arg) => [`get:${arg.id}`],
      t
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // 'get:11' should not be present in cache anymore
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 5)
  })

  await test('should not remove storage key by not existing reference', async (t) => {
    t.plan(7)
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      invalidate: () => ['foo'],
      t
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // 'get:11' should be still in cache
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 3)
  })

  await test('should invalidate more than one reference at once', async (t) => {
    t.plan(7)
    // Setup Fastify and Mercurius
    let miss = 0
    const app = setupServer({
      onMiss: () => ++miss,
      t
    })
    // Cache the follwoing
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 1)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 2)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // Request a mutation
    await request({ app, query: 'mutation { set(id: 11) }' })
    t.assert.strictEqual(miss, 3)
    // All 'get' should not be present in cache anymore
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(miss, 4)
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(miss, 4)
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(miss, 5)
  })

  await test('should remove storage keys by references, but not the ones still alive', async (t) => {
    t.plan(4)
    // Setup Fastify and Mercurius
    let failHit = false
    const app = setupServer({
      onHit () {
        if (failHit) t.fail()
      },
      t
    })
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    t.assert.strictEqual(
      await redisClient.get((await redisClient.smembers('r:get:11'))[0]),
      '"get 11"'
    )
    await request({ app, query: '{ get(id: 12) }' })
    t.assert.strictEqual(
      await redisClient.get((await redisClient.smembers('r:get:12'))[0]),
      '"get 12"'
    )
    await request({ app, query: '{ search(id: 11) }' })
    t.assert.strictEqual(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // Request a mutation, invalidate 'gets'
    await request({ app, query: 'mutation { set(id: 11) }' })
    // Check the references of 'searchs', should still be there
    t.assert.strictEqual(
      await redisClient.get((await redisClient.smembers('r:search:11'))[0]),
      '"search 11"'
    )
    // 'get:11' should not be present in cache anymore,
    failHit = true
    // should trigger onMiss and not onHit
    await request({ app, query: '{ get(id: 11) }' })
  })

  await test('should not throw on invalidation error', async (t) => {
    t.plan(3)
    // Setup Fastify and Mercurius
    const app = setupServer({
      invalidate () {
        throw new Error('Kaboom')
      },
      onError (type, fieldName, error) {
        t.assert.strictEqual(type, 'Mutation')
        t.assert.strictEqual(fieldName, 'set')
        t.assert.strictEqual(error.message, 'Kaboom')
      },
      t
    })
    // Run the request and cache it
    await request({ app, query: '{ get(id: 11) }' })
    await request({ app, query: 'mutation { set(id: 11) }' })
  })
})

describe('policy options', async () => {
  await test('custom key', async (t) => {
    t.beforeEach(async () => {
      await redisClient.flushall()
    })

    await test(
      'should be able to use a custom key function, without fields',
      async (t) => {
        t.plan(3)
        const app = fastify()
        t.after(() => app.close())

        const schema = `
    type Query {
      add(x: Int, y: Int): Int
      sub(x: Int, y: Int): Int
      mul(x: Int, y: Int): Int
    }
    `

        const resolvers = {
          Query: {
            async add (_, { x, y }) {
              return x + y
            },
            async sub (_, { x, y }) {
              return x - y
            },
            async mul (_, { x, y }) {
              return x * y
            }
          }
        }

        app.register(mercurius, { schema, resolvers })

        app.register(cache, {
          ttl: 999,
          storage: { type: 'redis', options: { client: redisClient } },
          policy: {
            Query: {
              add: {
                key ({ self, arg, info, ctx, fields }) {
                  return `${arg.x}+${arg.y}`
                }
              },
              sub: {
                key ({ self, arg, info, ctx, fields }) {
                  return `${arg.x}-${arg.y}`
                }
              },
              mul: {
                key ({ self, arg, info, ctx, fields }) {
                  return `${arg.x}*${arg.y}`
                }
              }
            }
          }
        })

        await request({ app, query: '{ add(x: 1, y: 1) }' })
        t.assert.strictEqual(await redisClient.get('Query.add~1+1'), '2')

        await request({ app, query: '{ sub(x: 2, y: 2) }' })
        t.assert.strictEqual(await redisClient.get('Query.sub~2-2'), '0')

        await request({ app, query: '{ mul(x: 3, y: 3) }' })
        t.assert.strictEqual(await redisClient.get('Query.mul~3*3'), '9')
      }
    )

    await test(
      'should be able to use a custom key function, with fields without selection',
      async (t) => {
        t.plan(8)
        const app = fastify()
        t.after(() => app.close())

        const schema = `
      type Query {
        getUser (id: ID!): User
        getUsers (name: String, lastName: String): [User]
      }

      type User {
        id: ID!
        name: String 
        lastName: String
      }
`

        const users = {
          a1: { name: 'Angus', lastName: 'Young' },
          b2: { name: 'Phil', lastName: 'Rudd' },
          c3: { name: 'Cliff', lastName: 'Williams' },
          d4: { name: 'Brian', lastName: 'Johnson' },
          e5: { name: 'Stevie', lastName: 'Young' }
        }

        const resolvers = {
          Query: {
            async getUser (_, { id }) {
              return users[id] ? { id, ...users[id] } : null
            },
            async getUsers (_, { name, lastName }) {
              const id = Object.keys(users).find((key) => {
                const user = users[key]
                if (name && user.name !== name) return false
                if (lastName && user.lastName !== lastName) return false
                return true
              })
              return id ? [{ id, ...users[id] }] : []
            }
          }
        }

        app.register(mercurius, { schema, resolvers })

        const hits = { getUser: 0, getUsers: 0 }
        app.register(cache, {
          ttl: 999,
          storage: {
            type: 'redis',
            options: { client: redisClient }
          },
          onHit (type, name) {
            hits[name]++
          },
          policy: {
            Query: {
              getUser: {
                key ({ self, arg, info, ctx, fields }) {
                  return `${arg.id}`
                }
              },
              getUsers: {
                key ({ self, arg, info, ctx, fields }) {
                  return `${arg.name || '*'},${arg.lastName || '*'}`
                }
              }
            }
          }
        })

        // use key and store in cache the user
        t.assert.deepStrictEqual(
          await request({
            app,
            query: '{ getUser(id: "a1") { name, lastName} }'
          }),
          {
            data: { getUser: { name: 'Angus', lastName: 'Young' } }
          }
        )
        t.assert.strictEqual(
          await redisClient.get('Query.getUser~a1'),
          JSON.stringify({ id: 'a1', lastName: 'Young', name: 'Angus' })
        )

        // use key and get the user from cache
        t.assert.deepStrictEqual(
          await request({ app, query: '{ getUser(id: "a1") { id } }' }),
          {
            data: { getUser: { id: 'a1' } }
          }
        )
        t.assert.strictEqual(hits.getUser, 1)

        // query users
        t.assert.deepStrictEqual(
          await request({
            app,
            query: '{ getUsers(name: "Brian") { id, name, lastName} }'
          }),
          {
            data: {
              getUsers: [{ id: 'd4', name: 'Brian', lastName: 'Johnson' }]
            }
          }
        )
        t.assert.strictEqual(
          await redisClient.get('Query.getUsers~Brian,*'),
          JSON.stringify([{ id: 'd4', lastName: 'Johnson', name: 'Brian' }])
        )

        t.assert.deepStrictEqual(
          await request({ app, query: '{ getUsers(name: "Brian") { name } }' }),
          {
            data: { getUsers: [{ name: 'Brian' }] }
          }
        )
        t.assert.strictEqual(hits.getUsers, 1)
      }
    )

    await test('should be able to use a custom key function, with fields selection', async (t) => {
      function selectedFields (info) {
        const fields = []
        for (let i = 0; i < info.fieldNodes.length; i++) {
          const node = info.fieldNodes[i]
          if (!node.selectionSet) {
            continue
          }
          for (let j = 0; j < node.selectionSet.selections.length; j++) {
            fields.push(node.selectionSet.selections[j].name.value)
          }
        }
        fields.sort()
        return fields
      }
      t.plan(9)
      const app = fastify()
      t.after(() => app.close())

      const schema = `
      type Query {
        getUser (id: ID!): User
        getUsers (name: String, lastName: String): [User]
      }

      type User {
        id: ID!
        name: String 
        lastName: String
      }
    `

      const users = {
        a1: { name: 'Angus', lastName: 'Young' },
        b2: { name: 'Phil', lastName: 'Rudd' },
        c3: { name: 'Cliff', lastName: 'Williams' },
        d4: { name: 'Brian', lastName: 'Johnson' },
        e5: { name: 'Stevie', lastName: 'Young' }
      }

      const resolvers = {
        Query: {
          async getUser (_, { id }, context, info) {
            if (!users[id]) {
              return null
            }
            const fields = selectedFields(info)
            const user = fields.reduce(
              (user, field) => ({ ...user, [field]: users[id][field] }),
              {}
            )
            if (fields.includes('id')) {
              user.id = id
            }
            return user
          },
          async getUsers (_, { name, lastName }, context, info) {
            const ids = Object.keys(users).filter((key) => {
              const user = users[key]
              if (name && user.name !== name) return false
              if (lastName && user.lastName !== lastName) return false
              return true
            })
            const fields = selectedFields(info)
            const withId = fields.includes('id')
            return ids.map((id) => {
              const user = fields.reduce(
                (user, field) => ({ ...user, [field]: users[id][field] }),
                {}
              )
              if (withId) {
                user.id = id
              }
              return user
            })
          }
        }
      }

      app.register(mercurius, { schema, resolvers })

      let hits = 0
      app.register(cache, {
        ttl: 999,
        storage: {
          type: 'redis',
          options: { client: redisClient }
        },
        onHit (type, name) {
          hits++
        },
        policy: {
          Query: {
            getUser: {
              key ({ self, arg, info, ctx, fields }) {
                return `${arg.id}:${fields.join()}`
              }
            },
            getUsers: {
              key ({ self, arg, info, ctx, fields }) {
                return `${arg.name || '*'},${
                  arg.lastName || '*'
                }:${fields.join()}`
              }
            }
          }
        }
      })

      // use key and store in cache the user
      t.assert.deepStrictEqual(
        await request({
          app,
          query: '{ getUser(id: "a1") { name, lastName} }'
        }),
        {
          data: { getUser: { name: 'Angus', lastName: 'Young' } }
        }
      )
      t.assert.strictEqual(
        await redisClient.get('Query.getUser~a1:lastName,name'),
        JSON.stringify({ lastName: 'Young', name: 'Angus' })
      )

      // use key and get the user from cache
      t.assert.deepStrictEqual(
        await request({ app, query: '{ getUser(id: "a1") { id } }' }),
        {
          data: { getUser: { id: 'a1' } }
        }
      )
      t.assert.strictEqual(
        await redisClient.get('Query.getUser~a1:id'),
        JSON.stringify({ id: 'a1' })
      )

      // query users
      t.assert.deepStrictEqual(
        await request({
          app,
          query: '{ getUsers(lastName: "Young") { id, name, lastName} }'
        }),
        {
          data: {
            getUsers: [
              { id: 'a1', name: 'Angus', lastName: 'Young' },
              { id: 'e5', name: 'Stevie', lastName: 'Young' }
            ]
          }
        }
      )
      t.assert.strictEqual(
        await redisClient.get('Query.getUsers~*,Young:id,lastName,name'),
        JSON.stringify([
          { id: 'a1', lastName: 'Young', name: 'Angus' },
          { id: 'e5', lastName: 'Young', name: 'Stevie' }
        ])
      )

      // query users different fields
      t.assert.deepStrictEqual(
        await request({
          app,
          query: '{ getUsers(lastName: "Young") { name } }'
        }),
        {
          data: { getUsers: [{ name: 'Angus' }, { name: 'Stevie' }] }
        }
      )
      t.assert.strictEqual(
        await redisClient.get('Query.getUsers~*,Young:name'),
        JSON.stringify([{ name: 'Angus' }, { name: 'Stevie' }])
      )

      // never used the cache
      t.assert.strictEqual(hits, 0)
    })
  })
})

describe('manual invalidation', async () => {
  beforeEach(async () => {
    await redisClient.flushall()
  })

  const createApp = ({ schema, resolvers, t, cacheOptions }) => {
    const app = fastify()
    t.after(() => app.close())
    app.register(mercurius, { schema, resolvers })
    app.register(cache, cacheOptions)
    return app
  }

  await test(
    'should be able to call invalidation with a reference',
    async (t) => {
      t.plan(1)
      let hits
      const app = createApp({
        t,
        schema: `
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
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            },
            countries () {
              return [{ name: 'Ireland' }, { name: 'Italy' }]
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: { client: redisClient, invalidation: true }
          },
          onHit (type, fieldName) {
            hits++
          },
          policy: {
            Query: {
              user: {
                references: (_request, _key, result) => {
                  if (!result) {
                    return
                  }
                  return [`user:${result.id}`]
                }
              }
            }
          }
        }
      })

      const query = '{ user(id: "1") { id, name } }'
      hits = 0
      await request({ app, query })
      await app.graphql.cache.invalidate('user:1')
      await request({ app, query })
      t.assert.strictEqual(hits, 0)
    }
  )

  await test(
    'should be able to call invalidation with wildcard',
    async (t) => {
      t.plan(1)
      let hits
      const app = createApp({
        t,
        schema: `
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
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            },
            countries () {
              return [{ name: 'Ireland' }, { name: 'Italy' }]
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: { client: redisClient, invalidation: true }
          },
          onHit (type, fieldName) {
            hits++
          },
          policy: {
            Query: {
              user: {
                references: (_request, _key, result) => {
                  if (!result) {
                    return
                  }
                  return [`user:${result.id}`]
                }
              }
            }
          }
        }
      })

      hits = 0
      await request({ app, query: '{ user(id: "1") { name } }' })
      await request({ app, query: '{ user(id: "2") { name } }' })
      await request({ app, query: '{ user(id: "3") { name } }' })
      await app.graphql.cache.invalidate('user:*')
      await request({ app, query: '{ user(id: "1") { name } }' })
      await request({ app, query: '{ user(id: "2") { name } }' })
      await request({ app, query: '{ user(id: "3") { name } }' })
      t.assert.strictEqual(hits, 0)
    }
  )

  await test(
    'should be able to call invalidation with an array of references',
    async (t) => {
      t.plan(1)
      let hits
      const app = createApp({
        t,
        schema: `
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
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            },
            countries () {
              return [{ name: 'Ireland' }, { name: 'Italy' }]
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: { client: redisClient, invalidation: true }
          },
          onHit (type, fieldName) {
            hits++
          },
          policy: {
            Query: {
              user: {
                references: (_request, _key, result) => {
                  if (!result) {
                    return
                  }
                  return [`user:${result.id}`]
                }
              }
            }
          }
        }
      })

      hits = 0
      await request({ app, query: '{ user(id: "1") { id, name } }' })
      await request({ app, query: '{ user(id: "2") { id, name } }' })
      await request({ app, query: '{ user(id: "3") { id, name } }' })
      await app.graphql.cache.invalidate(['user:1', 'user:2'])
      await request({ app, query: '{ user(id: "1") { id, name } }' })
      await request({ app, query: '{ user(id: "2") { id, name } }' })
      t.assert.strictEqual(hits, 0)
    }
  )

  await test(
    'should be able to call invalidation on a specific storage',
    async (t) => {
      t.plan(1)
      const app = createApp({
        t,
        schema: `
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
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            },
            countries () {
              return [{ name: 'Ireland' }, { name: 'Italy' }]
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: { client: redisClient, invalidation: true }
          },
          onHit (type, fieldName) {
            hits[`${type}.${fieldName}`]++
          },
          policy: {
            Query: {
              user: {
                references: (_request, _key, result) => {
                  if (!result) {
                    return
                  }
                  return [`user:${result.id}`]
                }
              },
              countries: {
                ttl: 86400, // 1 day
                storage: { type: 'memory', options: { invalidation: true } },
                references: () => ['countries']
              }
            }
          }
        }
      })

      const hits = { 'Query.user': 0, 'Query.countries': 0 }
      await request({ app, query: '{ user(id: "1") { id, name } }' })
      await request({ app, query: '{ countries { name } }' })

      await app.graphql.cache.invalidate('countries', 'Query.countries')
      await request({ app, query: '{ user(id: "1") { id, name } }' })
      await request({ app, query: '{ countries { name } }' })
      t.assert.deepStrictEqual(hits, { 'Query.user': 1, 'Query.countries': 0 })
    }
  )

  await test(
    'should get a warning calling invalidation when it is disabled',
    async (t) => {
      t.plan(1)

      const app = createApp({
        t,
        schema: `
      type User {
        id: ID!
        name: String!
      }
    
      type Query {
        user(id: ID!): User
      }
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: {
              client: redisClient,
              invalidation: false,
              log: {
                warn: (args) => {
                  t.assert.strictEqual(
                    args.msg,
                    'acd/storage/redis.invalidate, exit due invalidation is disabled'
                  )
                }
              }
            }
          },
          policy: {
            Query: { user: true }
          }
        }
      })

      await request({ app, query: '{ user(id: "1") { id, name } }' })
      app.graphql.cache.invalidate('user:1')
    }
  )

  await test(
    'should reject calling invalidation on a non-existing storage',
    async (t) => {
      t.plan(1)
      const app = createApp({
        t,
        schema: `
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
    `,
        resolvers: {
          Query: {
            user (_, { id }) {
              return { id, name: `User ${id}` }
            },
            countries () {
              return [{ name: 'Ireland' }, { name: 'Italy' }]
            }
          }
        },
        cacheOptions: {
          ttl: 99,
          storage: {
            type: 'redis',
            options: { client: redisClient, invalidation: true }
          },
          policy: {
            Query: {
              user: {
                references: (_request, _key, result) => {
                  if (!result) {
                    return
                  }
                  return [`user:${result.id}`]
                }
              },
              countries: {
                ttl: 86400, // 1 day
                storage: { type: 'memory', options: { invalidation: true } },
                references: () => ['countries']
              }
            }
          }
        }
      })

      await request({ app, query: '{ user(id: "1") { id, name } }' })
      await request({ app, query: '{ countries { name } }' })

      await t.assert.rejects(
        app.graphql.cache.invalidate('countries', 'non-existing-storage')
      )
    }
  )
})
