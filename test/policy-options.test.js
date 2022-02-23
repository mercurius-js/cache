'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const Redis = require('ioredis')
const cache = require('..')

const { request } = require('./helper')

test('cache different policies with different options / ttl', async ({ equal, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 100
  })
  teardown(() => clock.uninstall())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
    sub(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y },
      async sub (_, { x, y }) { return x - y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  const hits = { add: 0, sub: 0 }
  const misses = { add: 0, sub: 0 }

  app.register(cache, {
    ttl: 100,
    onHit (type, name) {
      hits[name] = hits[name] ? hits[name] + 1 : 1
    },
    onMiss (type, name) {
      misses[name] = misses[name] ? misses[name] + 1 : 1
    },
    policy: {
      Query: {
        add: { ttl: 1 },
        sub: { ttl: 2 }
      }
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 2) }' })

  await clock.tick(500)
  await request({ app, query: '{ add(x: 1, y: 1) }' })

  await clock.tick(2000)
  await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.add, 1)
  equal(misses.add, 1)

  equal(hits.sub, 0)
  equal(misses.sub, 2)
})

test('cache different policies with different options / storage', async ({ equal, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
    sub(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y },
      async sub (_, { x, y }) { return x - y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  const hits = { add: 0, sub: 0 }; const misses = { add: 0, sub: 0 }

  app.register(cache, {
    onHit (type, name) {
      hits[name]++
    },
    onMiss (type, name) {
      misses[name]++
    },
    policy: {
      Query: {
        add: { storage: { type: 'memory', options: { size: 1 } } },
        sub: { storage: { type: 'memory', options: { size: 2 } } }
      }
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
  await request({ app, query: '{ add(x: 2, y: 1) }' })
  await request({ app, query: '{ add(x: 1, y: 1) }' })

  await request({ app, query: '{ sub(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 1) }' })
  await request({ app, query: '{ sub(x: 3, y: 1) }' })
  await request({ app, query: '{ sub(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 1) }' })
  await request({ app, query: '{ sub(x: 3, y: 1) }' })

  equal(hits.add, 0, 'never hits the cache')
  equal(misses.add, 3)

  equal(hits.sub, 0, 'never hits the cache')
  equal(misses.sub, 6)
})

test('cache different policies with different options / skip', async ({ equal, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
    sub(x: Int, y: Int): Int
    mul(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y },
      async sub (_, { x, y }) {
        return x - y
      },
      async mul (_, { x, y }) { return x * y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  const hits = { add: 0, sub: 0, mul: 0 }
  const misses = { add: 0, sub: 0, mul: 0 }
  const skips = { add: 0, sub: 0, mul: 0 }

  app.register(cache, {
    ttl: 10,
    onHit (type, name) {
      hits[name]++
    },
    onMiss (type, name) {
      misses[name]++
    },
    onSkip (type, name) {
      skips[name]++
    },
    policy: {
      Query: {
        add: { skip: () => true },
        sub: true,
        mul: { skip: (self, arg, ctx, info) => arg.x > 9 }
      }
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
  await request({ app, query: '{ add(x: 2, y: 1) }' })
  await request({ app, query: '{ add(x: 3, y: 1) }' })

  await request({ app, query: '{ sub(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 1) }' })

  await request({ app, query: '{ mul(x: 1, y: 1) }' })
  await request({ app, query: '{ mul(x: 10, y: 1) }' })

  equal(hits.add, 0)
  equal(misses.add, 0)
  equal(skips.add, 3, 'always skipped')

  equal(hits.sub, 2, 'regular from cache')
  equal(misses.sub, 2)
  equal(skips.sub, 0)

  equal(hits.mul, 0)
  equal(misses.mul, 1)
  equal(skips.mul, 1, 'skipped if first arg > 9')
})

test('cache per user using extendKey option', async ({ equal, same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async hello (source, args, { reply, user }) {
        return user ? `Hello ${user}` : '?'
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    context: async (req) => {
      return {
        user: req.query.user
      }
    }
  })

  let hits = 0
  let misses = 0
  app.register(cache, {
    ttl: 10,
    policy: {
      Query: {
        hello: {
          extendKey: function (source, args, context, info) {
            return context.user ? `user:${context.user}` : undefined
          }
        }
      }
    },
    onHit () { hits++ },
    onMiss () { misses++ }
  })

  for (let i = 0; i < 3; i++) {
    const query = '{ hello }'
    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: '?'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=alice',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello alice'
        }
      })
    }

    {
      const res = await app.inject({
        method: 'POST',
        url: '/graphql?user=bob',
        body: { query }
      })

      equal(res.statusCode, 200)
      same(res.json(), {
        data: {
          hello: 'Hello bob'
        }
      })
    }
  }

  equal(misses, 3)
  equal(hits, 6)
})

test('should be able to use a custom key function, without fields', async t => {
  const redisClient = new Redis()
  await redisClient.flushall()

  const app = fastify()
  t.teardown(async () => Promise.all([app.close.bind(app), redisClient.quit()]))

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      sub(x: Int, y: Int): Int
      mul(x: Int, y: Int): Int
    }
    `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y },
      async sub (_, { x, y }) { return x - y },
      async mul (_, { x, y }) { return x * y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 9,
    storage: { type: 'redis', options: { client: redisClient } },
    policy: {
      Query: {
        add: { key ({ self, arg, info, ctx, fields }) { return `${arg.x}+${arg.y}` } },
        sub: { key ({ self, arg, info, ctx, fields }) { return `${arg.x}-${arg.y}` } },
        mul: { key ({ self, arg, info, ctx, fields }) { return `${arg.x}*${arg.y}` } }
      }
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
  t.equal(await redisClient.get('Query.add~1+1'), '2')

  await request({ app, query: '{ sub(x: 2, y: 2) }' })
  t.equal(await redisClient.get('Query.sub~2-2'), '0')

  await request({ app, query: '{ mul(x: 3, y: 3) }' })
  t.equal(await redisClient.get('Query.mul~3*3'), '9')
})

test('should be able to use a custom key function, with fields without selection', async t => {
  const redisClient = new Redis()
  await redisClient.flushall()

  const app = fastify()
  t.teardown(async () => Promise.all([app.close.bind(app), redisClient.quit()]))

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
      async getUser (_, { id }) { return users[id] ? { id, ...users[id] } : null },
      async getUsers (_, { name, lastName }) {
        const id = Object.keys(users).find(key => {
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
    ttl: 3,
    storage: {
      type: 'redis',
      options: { client: redisClient }
    },
    onHit (type, name) { hits[name]++ },
    policy: {
      Query: {
        getUser: { key ({ self, arg, info, ctx, fields }) { return `${arg.id}` } },
        getUsers: { key ({ self, arg, info, ctx, fields }) { return `${arg.name || '*'},${arg.lastName || '*'}` } }
      }
    }
  })

  // use key and store in cache the user
  t.same(await request({ app, query: '{ getUser(id: "a1") { name, lastName} }' }), {
    data: { getUser: { name: 'Angus', lastName: 'Young' } }
  })
  t.equal(await redisClient.get('Query.getUser~a1'), JSON.stringify({ id: 'a1', lastName: 'Young', name: 'Angus' }))

  // use key and get the user from cache
  t.same(await request({ app, query: '{ getUser(id: "a1") { id } }' }), {
    data: { getUser: { id: 'a1' } }
  })
  t.equal(hits.getUser, 1)

  // query users
  t.same(await request({ app, query: '{ getUsers(name: "Brian") { id, name, lastName} }' }), {
    data: { getUsers: [{ id: 'd4', name: 'Brian', lastName: 'Johnson' }] }
  })
  t.equal(await redisClient.get('Query.getUsers~Brian,*'), JSON.stringify([{ id: 'd4', lastName: 'Johnson', name: 'Brian' }]))

  t.same(await request({ app, query: '{ getUsers(name: "Brian") { name } }' }), {
    data: { getUsers: [{ name: 'Brian' }] }
  })
  t.equal(hits.getUsers, 1)
})

test('should be able to use a custom key function, with fields selection', async t => {
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

  const redisClient = new Redis()
  await redisClient.flushall()

  const app = fastify()
  t.teardown(async () => Promise.all([app.close.bind(app), redisClient.quit()]))

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
        if (!users[id]) { return null }
        const fields = selectedFields(info)
        const user = fields.reduce((user, field) => ({ ...user, [field]: users[id][field] }), {})
        if (fields.includes('id')) { user.id = id }
        return user
      },
      async getUsers (_, { name, lastName }, context, info) {
        const ids = Object.keys(users).filter(key => {
          const user = users[key]
          if (name && user.name !== name) return false
          if (lastName && user.lastName !== lastName) return false
          return true
        })
        const fields = selectedFields(info)
        const withId = fields.includes('id')
        return ids.map(id => {
          const user = fields.reduce((user, field) => ({ ...user, [field]: users[id][field] }), {})
          if (withId) { user.id = id }
          return user
        })
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  let hits = 0
  app.register(cache, {
    ttl: 3,
    storage: {
      type: 'redis',
      options: { client: redisClient }
    },
    onHit (type, name) { hits++ },
    policy: {
      Query: {
        getUser: { key ({ self, arg, info, ctx, fields }) { return `${arg.id}:${fields.join()}` } },
        getUsers: { key ({ self, arg, info, ctx, fields }) { return `${arg.name || '*'},${arg.lastName || '*'}:${fields.join()}` } }
      }
    }
  })

  // use key and store in cache the user
  t.same(await request({ app, query: '{ getUser(id: "a1") { name, lastName} }' }), {
    data: { getUser: { name: 'Angus', lastName: 'Young' } }
  })
  t.equal(await redisClient.get('Query.getUser~a1:lastName,name'), JSON.stringify({ lastName: 'Young', name: 'Angus' }))

  // use key and get the user from cache
  t.same(await request({ app, query: '{ getUser(id: "a1") { id } }' }), {
    data: { getUser: { id: 'a1' } }
  })
  t.equal(await redisClient.get('Query.getUser~a1:id'), JSON.stringify({ id: 'a1' }))

  // query users
  t.same(await request({ app, query: '{ getUsers(lastName: "Young") { id, name, lastName} }' }), {
    data: { getUsers: [{ id: 'a1', name: 'Angus', lastName: 'Young' }, { id: 'e5', name: 'Stevie', lastName: 'Young' }] }
  })
  t.equal(await redisClient.get('Query.getUsers~*,Young:id,lastName,name'), JSON.stringify([{ id: 'a1', lastName: 'Young', name: 'Angus' }, { id: 'e5', lastName: 'Young', name: 'Stevie' }]))

  // query users different fields
  t.same(await request({ app, query: '{ getUsers(lastName: "Young") { name } }' }), {
    data: { getUsers: [{ name: 'Angus' }, { name: 'Stevie' }] }
  })
  t.equal(await redisClient.get('Query.getUsers~*,Young:name'), JSON.stringify([{ name: 'Angus' }, { name: 'Stevie' }]))

  // never used the cache
  t.equal(hits, 0)
})
