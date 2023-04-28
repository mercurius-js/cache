'use strict'

const { test, mock, before, teardown } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const WebSocket = require('ws')
const cache = require('..')

const { promisify } = require('util')
const immediate = promisify(setImmediate)
const { request } = require('./helper')

let clock

before(() => {
  clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 0
  })
})

teardown(() => {
  clock.uninstall()
})

test('cache a resolver', async ({ equal, same, pass, plan, teardown }) => {
  plan(11)

  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        pass('add called only once')
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
      equal(type, 'Query')
      equal(name, 'add')
      hits++
    },
    onMiss (type, name) {
      equal(type, 'Query')
      equal(name, 'add')
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

    equal(res.statusCode, 200)
    same(res.json(), {
      data: {
        add: 4
      }
    })
  }

  equal(hits, 1)
  equal(misses, 1)
})

test('When within the stale threshold return the cached value and refresh the cache', async ({ equal, same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  equal(helloCalls, 1)
  equal(misses, 1)
  equal(hits, 0)
  same(data, {
    data: {
      hello: 'world'
    }
  })

  clock.tick(500)

  data = await query()

  equal(helloCalls, 1)
  equal(misses, 1)
  equal(hits, 1)
  same(data, {
    data: {
      hello: 'world'
    }
  })

  clock.tick(1000)

  helloResult = 'world!'
  data = await query()

  equal(helloCalls, 2)
  equal(misses, 1)
  equal(hits, 2)
  same(data, {
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

    equal(res.statusCode, 200)
    return res.json()
  }
})

test('No TTL, do not use cache', async ({ equal, same, pass, plan, teardown }) => {
  plan(7)

  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        pass('add called only once')
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

  equal(misses, 0)
  equal(hits, 0)

  async function query () {
    const query = '{ add(x: 2, y: 2) }'

    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: {
        query
      }
    })

    equal(res.statusCode, 200)
    same(res.json(), {
      data: {
        add: 4
      }
    })
  }
})

test('cache a nested resolver with loaders', async ({ same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  same(await request({ app, query: '{ dogs { owner { name } } }' }),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } })

  same(await request({ app, query: '{ dogs { owner { name } } }' }),
    { data: { dogs: [{ owner: { name: 'Jennifer' } }, { owner: { name: 'Sarah' } }, { owner: { name: 'Tracy' } }, { owner: { name: 'Jennifer' } }] } })

  same(misses, { Query: 1, Dog: 3 })
  same(hits, { Query: 1, Dog: 3 })
})

test('clear the cache', async ({ equal, same, pass, plan, teardown }) => {
  plan(6)

  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        pass('add called only once')
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

  await t.rejects(app.ready())
})

test('cache all resolvers', async ({ same, pass, teardown }) => {
  pass(4)
  const app = fastify()
  teardown(app.close.bind(app))

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
        pass('call Query.dogs')
        return dogs
      }
    }
  }

  const loaders = {
    Dog: {
      async owner (queries) {
        pass('call Dog.owner')
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

  same(res.json(),
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

  same(res2.json(),
    { data: { dogs: [{ name: 'Max', owner: { name: 'Jennifer' } }, { name: 'Charlie', owner: { name: 'Sarah' } }, { name: 'Buddy', owner: { name: 'Tracy' } }, { name: 'Max', owner: { name: 'Jennifer' } }] } }
  )
})

test('skip the cache', async ({ equal, same, pass, plan, teardown }) => {
  plan(8)

  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
      hello: String
    }
  `

  const resolvers = {
    Query: {
      async add (_, { x, y }) {
        pass('add called twice')
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
      same(arg, { x: 2, y: 2 })
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

  await t.rejects(app.ready())
})

test('skip the cache if operation is Subscription', ({ plan, teardown, fail, error, end, equal }) => {
  const app = fastify()
  plan(2)
  teardown(() => app.close())

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
      fail()
    },
    onHit () {
      fail()
    }
  })

  app.listen({ port: 0 }, err => {
    error(err)

    const ws = new WebSocket('ws://localhost:' + (app.server.address()).port + '/graphql', 'graphql-ws')
    const client = WebSocket.createWebSocketStream(ws, { encoding: 'utf8', objectMode: true })
    teardown(client.destroy.bind(client))
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

    client.on('data', chunk => {
      const data = JSON.parse(chunk)
      if (data.type === 'connection_ack') {
        app.graphql.pubsub.publish({
          topic: 'NOTIFICATION_ADDED',
          payload: {
            notificationAdded: {
              id: 1,
              message: 'test'
            }
          }
        })
      } else {
        equal(chunk, JSON.stringify({
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
        }))
        client.end()
        end()
      }
    })
  })
})

test('skip the cache if operation is Mutation', async ({ equal, same, teardown, fail, plan }) => {
  const app = fastify()
  plan(6)
  teardown(app.close.bind(app))

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
      fail()
    },
    onHit () {
      fail()
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

    equal(res.statusCode, 200)
    same(res.json(), {
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

    equal(res.statusCode, 200)
    same(res.json(), {
      data: {
        add: 30
      }
    })
  }
})

test('Unmatched schema for Query', async ({ rejects, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  await rejects(app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query
    }
  }), 'policies does not match schema: Query.foo')
})

test('use references and invalidation', async ({ fail, pass, plan, teardown }) => {
  plan(1)

  const app = fastify()
  teardown(app.close.bind(app))

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
      fail()
    },
    onMiss (type, name) {
      if (++miss === 2) { pass() }
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

test('sync invalidation and references', async ({ fail, pass, plan, teardown }) => {
  plan(1)

  const app = fastify()
  teardown(app.close.bind(app))

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
      fail()
    },
    onMiss (type, name) {
      if (++miss === 2) { pass() }
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

test('should get the result even if cache functions throw an error / skip', async ({ same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  same(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / onSkip', async ({ same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  same(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / policy.skip', async ({ same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

  same(await request({ app, query: '{ add(x: 1, y: 1) }' }), { data: { add: 2 } })
})

test('should get the result even if cache functions throw an error / sync policy.invalidate', async ({ teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

test('should call onError if skip function throws an error', async ({ plan, teardown, equal, same }) => {
  plan(4)

  const app = fastify()
  teardown(app.close.bind(app))

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
      equal(type, 'Query')
      equal(name, 'get')
      equal(error.message, 'kaboom')
    }
  })

  same(await request({ app, query: '{ get(id: 11) }' }), { data: { get: 'get 11' } })
})

test('should not call onError if skip defined and resolver function throws an error', async ({ plan, teardown, fail, same }) => {
  plan(1)

  const app = fastify()
  teardown(app.close.bind(app))

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
    onError: () => fail()
  })

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: '{ get(id: 11) }' }
  })

  same(res.json(), { data: { get: null }, errors: [{ message: 'kaboom', locations: [{ line: 1, column: 3 }], path: ['get'] }] })
})

test('should call onError if Query resolver function throws an error', async ({ plan, equal, teardown }) => {
  plan(3)
  const app = fastify()
  teardown(app.close.bind(app))

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
      equal(type, 'Query')
      equal(name, 'add')
      equal(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('should not call onError if Mutation resolver throws', async ({ same, teardown, fail, plan }) => {
  const app = fastify()
  plan(1)
  teardown(app.close.bind(app))

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
    onError: () => fail()
  })

  const query = 'mutation { add(a: 11 b: 19) }'

  const res = await app.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query
    }
  })
  same(res.json(), { data: { add: null }, errors: [{ message: 'kaboom', locations: [{ line: 1, column: 12 }], path: ['add'] }] })
})

test('should call onError if invalidation function throws an error', async ({ equal, plan, teardown }) => {
  plan(3)

  const app = fastify()
  teardown(app.close.bind(app))

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
      equal(type, 'Mutation')
      equal(name, 'set')
      equal(error.message, 'kaboom')
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

test('should call onError internally inside async-cache-dedupe for resolver', async ({ equal, plan, teardown }) => {
  plan(4)

  const app = fastify()
  teardown(app.close.bind(app))

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
  const mockCache = mock('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const created = dedupe.createCache(options)
        const originalDefine = created.define.bind(created)
        created.define = function (name, opts, func) {
          const originalError = opts.onError
          opts.onError = function (error) {
            equal(error.message, 'kaboom')
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
      equal(type, 'Query')
      equal(name, 'add')
      equal(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('should not call onError internally inside async-cache-dedupe for invalidation', async ({ equal, plan, teardown, fail }) => {
  plan(3)

  const app = fastify()
  teardown(app.close.bind(app))

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
  const mockCache = mock('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const created = dedupe.createCache(options)
        options.onError = () => fail()
        const originalDefine = created.define.bind(created)
        created.define = function (name, opts, func) {
          opts.onError = () => fail()
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
      equal(type, 'Mutation')
      equal(name, 'set')
      equal(error.message, 'kaboom')
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

test('should call onError with Internal Error when mocked define receives no onError', async ({ equal, plan, teardown }) => {
  plan(4)

  const app = fastify()
  teardown(app.close.bind(app))

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
  const mockCache = mock('..', {
    'async-cache-dedupe': {
      createCache: (options) => {
        const originalError = options.onError
        options.onError = (error) => {
          equal(error.message, 'kaboom')
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
      equal(type, 'Internal Error')
      equal(name, 'async-cache-dedupe')
      equal(error.message, 'kaboom')
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
})

test('references throws', async ({ fail, pass, teardown, same, equal }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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
      fail()
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

  same(res.json(), { data: { get: 'get 11' } })
  equal(miss, 1)
})

test('policy without Query', async ({ teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))

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

test('cache nested resolvers with __options', async ({ same, pass, plan, teardown }) => {
  pass(4)
  const app = fastify()
  teardown(app.close.bind(app))

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
        pass('call Query.dogs')
        return dogs
      }
    }
  }

  const loaders = {
    Dog: {
      async owner (queries) {
        pass('call Dog.owner')
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

  same(res.json(),
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

  same(res2.json(),
    { data: { dogs: [{ name: 'Max', owner: { name: 'Jennifer' } }, { name: 'Charlie', owner: { name: 'Sarah' } }, { name: 'Buddy', owner: { name: 'Tracy' } }, { name: 'Max', owner: { name: 'Jennifer' } }] } }
  )
})

test('should be able to clear pragmatically the cache', async (t) => {
  const app = fastify()
  t.teardown(async () => {
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
      t.fail('should never use the cache')
    },
    onMiss (type, name) {
      misses++
    }
  })

  t.same(await request({ app, query: '{ echo (value: "Alpha") }' }), { data: { echo: 'Alpha' } })

  await app.graphql.cache.clear()

  t.same(await request({ app, query: '{ echo (value: "Alpha") }' }), { data: { echo: 'Alpha' } })

  t.equal(misses, 2)
})

test('should call original resolver only once on resolver error', async (t) => {
  const app = fastify()
  t.teardown(async () => {
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

  t.equal(count, 1)
})

test('should get error on resolver error', async (t) => {
  // solve https://github.com/mercurius-js/cache/issues/116
  const app = fastify()
  t.teardown(async () => {
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

  t.equal(count, 1)
  t.same(result.data, { hello: null })
  t.same(result.errors[0].message, 'THE_ERROR')
})
