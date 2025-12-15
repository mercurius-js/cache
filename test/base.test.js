'use strict'

const { test } = require('node:test')
const { setTimeout } = require('node:timers/promises')
const fastify = require('fastify')
const mercurius = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const WebSocket = require('ws')
const cache = require('..')

const { promisify } = require('util')
const immediate = promisify(setImmediate)
const { request } = require('./helper')
const proxyquire = require('proxyquire')

let clock

test.before(() => {
  clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 0
  })
})

test.afterEach(() => {
  clock.runAll()
})

test.after(() => {
  clock.uninstall()
})

test('cache a resolver', async (t) => {
  t.plan(11)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        t.assert.ok('add called only once')
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  let hits = 0
  let misses = 0

  app.register(cache, {
    ttl: 4242,
    onHit (type, name) {
      t.assert.strictEqual(type, 'Query')
      t.assert.strictEqual(name, 'add')
      hits++
    },
    onMiss (type, name) {
      t.assert.strictEqual(type, 'Query')
      t.assert.strictEqual(name, 'add')
      misses++
    },
    policy: {
      Query: {
        add: true
      }
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }

  t.assert.strictEqual(hits, 1)
  t.assert.strictEqual(misses, 1)
})

test('When within the stale threshold return the cached value and refresh the cache', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      hello: String
    }
  `

  let helloCalls = 0
  let helloResult = 'world'

  const resolvers = {
    Query: {
      async hello (_) {
        helloCalls++
        return helloResult
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  let misses = 0
  let hits = 0

  app.register(cache, {
    onHit (type, name) {
      hits++
    },
    onMiss (type, name) {
      misses++
    },
    policy: {
      Query: {
        hello: true
      }
    },
    ttl: 1,
    stale: 1
  })

  let data = await query()

  t.assert.strictEqual(helloCalls, 1)
  t.assert.strictEqual(misses, 1)
  t.assert.strictEqual(hits, 0)
  t.assert.deepStrictEqual(data, {
    data: {
      hello: 'world'
    }
  })

  clock.tick(500)

  data = await query()

  t.assert.strictEqual(helloCalls, 1)
  t.assert.strictEqual(misses, 1)
  t.assert.strictEqual(hits, 1)
  t.assert.deepStrictEqual(data, {
    data: {
      hello: 'world'
    }
  })

  clock.tick(1000)

  helloResult = 'world!'
  data = await query()

  t.assert.strictEqual(helloCalls, 2)
  t.assert.strictEqual(misses, 1)
  t.assert.strictEqual(hits, 2)
  t.assert.deepStrictEqual(data, {
    data: {
      hello: 'world'
    }
  })

  async function query () {
    const query = '{ hello }'

    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    return res.json()
  }
})

test('Dynamically specify ttl with function', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      cacheTime: Int
    }
  `

  const resolvers = {
    Query: {
      async cacheTime (_) {
        return 10
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  let misses = 0
  let hits = 0

  app.register(cache, {
    onHit () {
      hits++
    },
    onMiss () {
      misses++
    },
    policy: {
      Query: {
        cacheTime: true
      }
    },
    ttl: (result) => {
      t.assert.strictEqual(result, 10)
      return result || 2
    }
  })

  let data = await query()

  t.assert.strictEqual(misses, 1)
  t.assert.strictEqual(hits, 0)
  t.assert.deepStrictEqual(data, {
    data: {
      cacheTime: 10
    }
  })

  clock.tick(5000)

  data = await query()

  t.assert.strictEqual(misses, 1)
  t.assert.strictEqual(hits, 1)
  t.assert.deepStrictEqual(data, {
    data: {
      cacheTime: 10
    }
  })

  clock.tick(5000)

  data = await query()

  t.assert.strictEqual(misses, 2)
  t.assert.strictEqual(hits, 1)
  t.assert.deepStrictEqual(data, {
    data: {
      cacheTime: 10
    }
  })

  async function query () {
    const query = '{ cacheTime }'

    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    return res.json()
  }
})

test('No TTL, do not use cache', async (t) => {
  t.plan(7)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        t.assert.ok('add called only once')
        await immediate()
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  let misses = 0
  let hits = 0

  app.register(cache, {
    onHit (type, name) {
      hits++
    },
    onMiss (type, name) {
      misses++
    },
    policy: {
      Query: {
        add: true
      }
    }
  })

  await Promise.all([
    query(),
    query()
  ])

  t.assert.strictEqual(misses, 0)
  t.assert.strictEqual(hits, 0)

  async function query () {
    const query = '{ add(x: 2, y: 2) }'

    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }
})

test('cache a nested resolver with loaders', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const dogs = [{ name: 'Max' }, { name: 'Charlie' }, { name: 'Buddy' }, { name: 'Max' }]
  const owners = { Max: { name: 'Jennifer' }, Charlie: { name: 'Sarah' }, Buddy: { name: 'Tracy' } }

  const schema = `
    type Human {
      name: String!
    }

    type Dog {
      name: String!
      owner: Human
    }

    type Query {
      dogs: [Dog]
    }
  `

  const resolvers = {
    Query: {
      dogs (_, params, { reply }) { return dogs }
    }
  }

  const loaders = {
    Dog: {
      async owner (queries) { return queries.map(({ obj }) => owners[obj.name]) }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    loaders
  })

  const hits = { Query: 0, Dog: 0 }
  const misses = { Query: 0, Dog: 0 }

  app.register(cache, {
    ttl: 10,
    onHit (type, name) {
      hits[type]++
    },
    onMiss (type, name) {
      misses[type]++
    },
    policy: {
      Dog: {
        owner: true
      },
      Query: {
        dogs: true
      }
    }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ dogs { owner { name } } }' }),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } })

  t.assert.deepStrictEqual(await request({ app, query: '{ dogs { owner { name } } }' }),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } })

  t.assert.deepStrictEqual(misses, { Query: 1, Dog: 3 })
  t.assert.deepStrictEqual(hits, { Query: 1, Dog: 3 })
})

test('clear the cache', async (t) => {
  t.plan(6)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        t.assert.ok('add called only once')
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    policy: {
      Query: {
        add: true
      }
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }

  app.graphql.cache.clear()

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }
})

test('missing policy', async (t) => {
  const app = fastify()
  app.register(mercurius)
  app.register(cache)

  await t.assert.rejects(app.ready())
})

test('cache all resolvers', async (t) => {
  t.plan(6)
  const app = fastify()
  t.after(() => app.close())

  const dogs = [{
    name: 'Max'
  }, {
    name: 'Charlie'
  }, {
    name: 'Buddy'
  }, {
    name: 'Max'
  }]

  const owners = {
    Max: {
      name: 'Jennifer'
    },
    Charlie: {
      name: 'Sarah'
    },
    Buddy: {
      name: 'Tracy'
    }
  }

  const schema = `
    type Human {
      name: String!
    }

    type Dog {
      name: String!
      owner: Human
    }

    type Query {
      dogs: [Dog]
    }
  `

  const resolvers = {
    Query: {
      dogs (_, params, { reply }) {
        t.assert.ok('call Query.dogs')
        return dogs
      }
    }
  }

  const loaders = {
    Dog: {
      async owner (queries) {
        t.assert.ok('call Dog.owner')
        return queries.map(({ obj }) => owners[obj.name])
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    loaders
  })

  app.register(cache, {
    all: true
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `{
        dogs {
          owner {
            name
          }
        }
      }`
    }
  })

  t.assert.deepStrictEqual(res.json(),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } }
  )

  const res2 = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `{
        dogs {
          name
          owner {
            name
          }
        }
      }`
    }
  })

  t.assert.deepStrictEqual(res2.json(),
    { data: { dogs: [{ name: 'Max', owner: { name: 'Jennifer' } }, { name: 'Charlie', owner: { name: 'Sarah' } }, { name: 'Buddy', owner: { name: 'Tracy' } }, { name: 'Max', owner: { name: 'Jennifer' } }] } }
  )
})

test('skip the cache', async (t) => {
  t.plan(8)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        t.assert.ok('add called twice')
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    async skip (self, arg, ctx, info) {
      t.assert.deepStrictEqual(arg, { x: 2, y: 2 })
      if (ctx.reply.request.headers.authorization) {
        return true
      }
      return false
    },
    policy: {
      Query: {
        add: true
      }
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      headers: {
        Authorization: 'Bearer xyz'
      },
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 4
      }
    })
  }
})

test('using both policy and all options', async (t) => {
  const app = fastify()
  app.register(mercurius)
  app.register(cache, {
    all: true,
    policy: { Query: { add: true } }
  })

  await t.assert.rejects(app.ready())
})

test('skip the cache if operation is Subscription', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Notification {
    id: ID!
    message: String
  }
  type Query {
    notifications: [Notification]
  }
  type Subscription {
    notificationAdded: Notification
  }
`
  const notifications = []

  const resolvers = {
    Query: {
      notifications: () => notifications
    },
    Subscription: {
      notificationAdded: {
        subscribe: (_, __, { pubsub }) => pubsub.subscribe('NOTIFICATION_ADDED')
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    subscription: true
  })

  app.register(cache, {
    all: true,
    onSkip () {
      t.assert.fail()
    },
    onHit () {
      t.assert.fail()
    }
  })

  await app.listen({ port: 0 })

  const ws = new WebSocket('ws://localhost:' + (app.server.address()).port + '/graphql', 'graphql-ws')
  const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8', objectMode: true })
  t.after(() => {
    client.destroy()
    ws.close()
  })
  client.setEncoding('utf8')

  client.write(JSON.stringify({
    type: 'connection_init'
  }))

  client.write(JSON.stringify({
    id: 1,
    type: 'start',
    payload: {
      query: `
      subscription {
        notificationAdded {
          id
          message
        }
      }
      `
    }
  }))

  await new Promise((resolve, _reject) => {
    client.on('data', (chunk) => {
      const data = JSON.parse(chunk)
      if (data.type === 'connection_ack') {
        const p = setTimeout(100)
        clock.tick(100)
        p.then(() => {
          app.graphql.pubsub.publish({
            topic: 'NOTIFICATION_ADDED',
            payload: {
              notificationAdded: {
                id: 1,
                message: 'test'
              }
            }
          })
        })
      } else if (data.type === 'data') {
        t.assert.deepStrictEqual(data, {
          type: 'data',
          id: 1,
          payload: {
            data: {
              notificationAdded: {
                id: '1',
                message: 'test'
              }
            }
          }
        })
        ws.close()
        resolve()
      }
    })
    client.on('error', _reject)
  })
})

test('skip the cache if operation is Mutation', async (t) => {
  const app = fastify()
  t.plan(6)
  t.after(() => app.close())

  const schema = `
    type Mutation {
      add(a: Int, b: Int): Int
    }
    type Query {
      hello: String
    }
  `

  const resolvers = {
    Mutation: {
      add: (_, { a, b }) => a + b
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    all: true,
    onSkip () {
      t.assert.fail()
    },
    onHit () {
      t.assert.fail()
    }
  })

  const query = 'mutation { add(a: 11 b: 19) }'

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 30
      }
    })
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 30
      }
    })
  }

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    t.assert.strictEqual(res.statusCode, 200)
    t.assert.deepStrictEqual(res.json(), {
      data: {
        add: 30
      }
    })
  }
})

test('Unmatched schema for Query', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
      type Query {
        add(x: Int, y: Int): Int
      }
    `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        await immediate()
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    policy: {
      Query: {
        add: true,
        foo: 'bar'
      }
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  await t.assert.rejects(app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query
    }
  }), 'policies does not match schema: Query.foo')
})

test('use references and invalidation', async (t) => {
  t.plan(1)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  let miss = 0
  app.register(cache, {
    ttl: 100,
    storage: { type: 'memory', options: { invalidation: true } },
    onHit (type, name) {
      t.assert.fail()
    },
    onMiss (type, name) {
      if (++miss === 2) { t.assert.ok() }
    },
    policy: {
      Query: {
        get: {
          references: async () => ['gets']
        }
      },
      Mutation: {
        set: {
          invalidate: async () => ['gets']
        }
      }
    }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: 'mutation { set(id: 11) }' }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })
})

test('sync invalidation and references', async (t) => {
  t.plan(1)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  let miss = 0
  app.register(cache, {
    ttl: 100,
    storage: { type: 'memory', options: { invalidation: true } },
    onHit (type, name) {
      t.assert.fail()
    },
    onMiss (type, name) {
      if (++miss === 2) { t.assert.ok() }
    },
    policy: {
      Query: {
        get: {
          references: () => ['gets']
        }
      },
      Mutation: {
        set: {
          invalidate: () => ['gets']
        }
      }
    }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: 'mutation { set(id: 11) }' }
  })

  await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })
})

test('should get the result even if cache functions throw an error / skip', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 10,
    all: true,
    skip: () => { throw new Error('kaboom') }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / onSkip', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 10,
    all: true,
    onSkip: () => { throw new Error('kaboom') }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / policy.skip', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { return x + y }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 10,
    policy: {
      Query: {
        add: { skip: () => { throw new Error('kaboom') } }
      }
    }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / sync policy.invalidate', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })
  app.register(cache, {
    ttl: 100,
    storage: { type: 'memory', options: { invalidation: true } },
    policy: {
      Mutation: {
        set: {
          // invalidate: () => { throw new Error('kaboom') }
        }
      },
      Query: { get: true }
    }
  })

  await request({ app, query: 'mutation { set(id: 11) }' })
})

test('should call onError if skip function throws an error', async (t) => {
  t.plan(4)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
  `

  const resolvers = {
    Query: { async get (_, { id }) { return 'get ' + id } }
  }

  app.register(mercurius, { schema, resolvers })
  app.register(cache, {
    ttl: 1,
    all: true,
    skip: () => { throw new Error('kaboom') },
    onError (type, name, error) {
      t.assert.strictEqual(type, 'Query')
      t.assert.strictEqual(name, 'get')
      t.assert.strictEqual(error.message, 'kaboom')
    }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ get(id: 11) }' }), { data: { get: 'get 11' } })
})

test('should not call onError if skip defined and resolver function throws an error', async (t) => {
  t.plan(1)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
  `

  const resolvers = {
    Query: { async get (_, { id }) { throw new Error('kaboom') } }
  }

  app.register(mercurius, { schema, resolvers })
  app.register(cache, {
    ttl: 1,
    all: true,
    skip: () => { return true },
    onError: () => t.assert.fail()
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })

  t.assert.deepStrictEqual(res.json(), { data: { get: null }, errors: [{ message: 'kaboom', locations: [{ line: 1, column: 3 }], path: ['get'] }] })
})

test('should call onError if Query resolver function throws an error', async (t) => {
  t.plan(3)
  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { throw new Error('kaboom') }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 1,
    all: true,
    onError: (type, name, error) => {
      t.assert.strictEqual(type, 'Query')
      t.assert.strictEqual(name, 'add')
      t.assert.strictEqual(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('should not call onError if Mutation resolver throws', async (t) => {
  const app = fastify()
  t.plan(1)
  t.after(() => app.close())

  const schema = `
    type Mutation {
      add(a: Int, b: Int): Int
    }
    type Query {
      hello: String
    }
  `

  const resolvers = {
    Mutation: {
      add: (_, { a, b }) => { throw new Error('kaboom') }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    all: true,
    onError: () => t.assert.fail()
  })

  const query = 'mutation { add(a: 11 b: 19) }'

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query
    }
  })
  t.assert.deepStrictEqual(res.json(), { data: { add: null }, errors: [{ message: 'kaboom', locations: [{ line: 1, column: 12 }], path: ['add'] }] })
})

test('should call onError if invalidation function throws an error', async (t) => {
  t.plan(3)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  app.register(cache, {
    ttl: 1,
    storage: { type: 'memory', options: { invalidation: true } },
    onError (type, name, error) {
      t.assert.strictEqual(type, 'Mutation')
      t.assert.strictEqual(name, 'set')
      t.assert.strictEqual(error.message, 'kaboom')
    },
    policy: {
      Query: { get: { references: async () => ['gets'] } },
      Mutation: {
        set: {
          invalidate: async () => { throw new Error('kaboom') }
        }
      }
    }
  })

  await request({ app, query: '{ get(id: 11) }' })
  await request({ app, query: 'mutation { set(id: 11) }' })
  await request({ app, query: '{ get(id: 11) }' })
})

test('should call onError internally inside async-cache-dedupe for resolver', async (t) => {
  t.plan(4)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { throw new Error('kaboom') }
    }
  }

  app.register(mercurius, { schema, resolvers })

  // Checking inside async-cache-dedupe
  const dedupe = require('async-cache-dedupe')
  const mockCache = proxyquire('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const created = dedupe.createCache(options)
        const originalDefine = created.define.bind(created)
        created.define = function (name, opts, func) {
          const originalError = opts.onError
          opts.onError = function (error) {
            t.assert.strictEqual(error.message, 'kaboom')
            originalError(error)
          }
          return originalDefine(name, opts, func)
        }
        return created
      }
    }
  })

  app.register(mockCache, {
    ttl: 1,
    all: true,
    onError: (type, name, error) => {
      t.assert.strictEqual(type, 'Query')
      t.assert.strictEqual(name, 'add')
      t.assert.strictEqual(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('should not call onError internally inside async-cache-dedupe for invalidation', async (t) => {
  t.plan(3)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  // Checking inside async-cache-dedupe, invalidate should not call onError
  const dedupe = require('async-cache-dedupe')
  const mockCache = proxyquire('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const created = dedupe.createCache(options)
        options.onError = () => t.assert.fail()
        const originalDefine = created.define.bind(created)
        created.define = function (name, opts, func) {
          opts.onError = () => t.assert.fail()
          return originalDefine(name, opts, func)
        }
        return created
      }
    }
  })

  app.register(mockCache, {
    ttl: 1,
    storage: { type: 'memory', options: { invalidation: true } },
    onError (type, name, error) {
      t.assert.strictEqual(type, 'Mutation')
      t.assert.strictEqual(name, 'set')
      t.assert.strictEqual(error.message, 'kaboom')
    },
    policy: {
      Query: { get: { references: async () => ['gets'] } },
      Mutation: {
        set: {
          invalidate: async () => { throw new Error('kaboom') }
        }
      }
    }
  })

  await request({ app, query: '{ get(id: 11) }' })
  await request({ app, query: 'mutation { set(id: 11) }' })
  await request({ app, query: '{ get(id: 11) }' })
})

test('should call onError with Internal Error when mocked define receives no onError', async (t) => {
  t.plan(4)

  const app = fastify()
  t.after(() => app.close())

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
  }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) { throw new Error('kaboom') }
    }
  }

  app.register(mercurius, { schema, resolvers })

  /** Mocking cache.define to receive no onError
    * Doing this to check the usage of onError passed in
    * the definition of cache:
    * createCache({ ... onError: onError.bind(null, 'Internal Error', 'async-cache-dedupe') })
    * */
  const dedupe = require('async-cache-dedupe')
  const mockCache = proxyquire('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const originalError = options.onError
        options.onError = (error) => {
          t.assert.strictEqual(error.message, 'kaboom')
          originalError(error)
        }
        const created = dedupe.createCache(options)
        const originalDefine = created.define.bind(created)
        created.define = function (name, opts, func) {
          opts.onError = null
          return originalDefine(name, opts, func)
        }
        return created
      }
    }
  })

  app.register(mockCache, {
    ttl: 1,
    all: true,
    onError: (type, name, error) => {
      t.assert.strictEqual(type, 'Internal Error')
      t.assert.strictEqual(name, 'async-cache-dedupe')
      t.assert.strictEqual(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('references throws', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      get (id: Int): String
    }
    type Mutation {
      set (id: Int): String
    }
  `

  const resolvers = {
    Query: {
      async get (_, { id }) {
        return 'get ' + id
      }
    },
    Mutation: {
      async set (_, { id }) {
        return 'set ' + id
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  let miss = 0
  app.register(cache, {
    ttl: 100,
    storage: { type: 'memory', options: { invalidation: true } },
    onHit (type, name) {
      t.assert.fail()
    },
    onMiss (type, name) {
      miss++
    },
    policy: {
      Query: {
        get: {
          references: async () => { throw new Error('kaboom') }
        }
      },
      Mutation: {
        set: {
          invalidate: async () => ['gets']
        }
      }
    }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })

  t.assert.deepStrictEqual(res.json(), { data: { get: 'get 11' } })
  t.assert.strictEqual(miss, 1)
})

test('policy without Query', async (t) => {
  const app = fastify()
  t.after(() => app.close())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  app.register(cache, {
    ttl: 4242,
    all: false,
    policy: {}
  })

  await app.ready()
})

test('cache nested resolvers with __options', async (t) => {
  t.plan(6)
  const app = fastify()
  t.after(() => app.close())

  const dogs = [{
    name: 'Max'
  }, {
    name: 'Charlie'
  }, {
    name: 'Buddy'
  }, {
    name: 'Max'
  }]

  const owners = {
    Max: {
      name: 'Jennifer'
    },
    Charlie: {
      name: 'Sarah'
    },
    Buddy: {
      name: 'Tracy'
    }
  }

  const schema = `
    type Human {
      name: String!
    }
    type Dog {
      name: String!
      owner: Human
    }
    type Query {
      dogs: [Dog]
    }
  `

  const resolvers = {
    Query: {
      dogs (_, params, { reply }) {
        t.assert.ok('call Query.dogs')
        return dogs
      }
    }
  }

  const loaders = {
    Dog: {
      async owner (queries) {
        t.assert.ok('call Dog.owner')
        return queries.map(({ obj }) => owners[obj.name])
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    loaders
  })

  app.register(cache, {
    policy: {
      Query: {
        dogs: {
          __options: {
            ttl: 1
          }
        }
      }
    }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `{
        dogs {
          owner {
            name
          }
        }
      }`
    }
  })

  t.assert.deepStrictEqual(res.json(),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } }
  )

  const res2 = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `{
        dogs {
          name
          owner {
            name
          }
        }
      }`
    }
  })

  t.assert.deepStrictEqual(res2.json(),
    { data: { dogs: [{ name: 'Max', owner: { name: 'Jennifer' } }, { name: 'Charlie', owner: { name: 'Sarah' } }, { name: 'Buddy', owner: { name: 'Tracy' } }, { name: 'Max', owner: { name: 'Jennifer' } }] } }
  )
})

test('should be able to clear pragmatically the cache', async (t) => {
  const app = fastify()
  t.after(async () => {
    await app.close()
  })

  const resolvers = {
    Query: {
      async echo (_, { value }) {
        return value
      }
    }
  }

  app.register(mercurius, {
    schema: `
      type Query {
        echo (value: String) : String
      }
    `,
    resolvers
  })

  let misses = 0
  await app.register(cache, {
    ttl: 999,
    policy: {
      Query: {
        echo: true
      }
    },
    onHit (type, name) {
      t.t.assert.fail('should never use the cache')
    },
    onMiss (type, name) {
      misses++
    }
  })

  t.assert.deepStrictEqual(await request({ app, query: '{ echo (value: "Alpha") }' }), { data: { echo: 'Alpha' } })

  await app.graphql.cache.clear()

  t.assert.deepStrictEqual(await request({ app, query: '{ echo (value: "Alpha") }' }), { data: { echo: 'Alpha' } })

  t.assert.strictEqual(misses, 2)
})

test('should call original resolver only once on resolver error', async (t) => {
  const app = fastify()
  t.after(async () => {
    await app.close()
  })

  let count = 0

  const resolvers = {
    Query: {
      hello () {
        count++
        throw new Error('oops')
      }
    }
  }

  app.register(mercurius, {
    schema: `
      type Query {
        hello: String
      }
    `,
    resolvers
  })

  await app.register(cache, {
    ttl: 2,
    all: true,
    storage: { type: 'memory' }
  })

  await request({ app, query: '{ hello }' })

  t.assert.strictEqual(count, 1)
})

test('should get error on resolver error', async (t) => {
  // solve https://github.com/mercurius-js/cache/issues/116
  const app = fastify()
  t.after(async () => {
    await app.close()
  })

  let count = 0

  const schema = `#graphql
  type Query {
    hello: String
  }
  `

  const resolvers = {
    Query: {
      hello () {
        count++
        throw new Error('THE_ERROR')
      }
    }
  }

  app.register(mercurius, { schema, resolvers })

  await app.register(cache, {
    ttl: 2,
    all: true,
    storage: { type: 'memory' }
  })

  const result = await request({ app, query: '{ hello }' })

  t.assert.strictEqual(count, 1)
  t.assert.deepStrictEqual(result.data, { hello: null })
  t.assert.deepStrictEqual(result.errors[0].message, 'THE_ERROR')
})
