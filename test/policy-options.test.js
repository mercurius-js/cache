'use strict'

const { test, before, teardown, afterEach } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const cache = require('..')

const { request } = require('./helper')

let clock
before(() => {
  clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 0
  })
})

afterEach(() => {
  clock.runAll()
})

teardown(() => {
  clock.uninstall()
})

test('different cache while revalidate options for policies', async ({ equal, teardown, same }) => {
  const app = fastify()
  teardown(app.close.bind(app))

  const schema = `
  type Query {
    add(x: Int, y: Int): Int
    sub(x: Int, y: Int): Int
  }
  `

  let addCounter = 0
  let subCounter = 0

  const resolvers = {
    Query: {
      async add () { return ++addCounter },
      async sub () { return ++subCounter }
    }
  }

  app.register(mercurius, { schema, resolvers })

  const hits = { add: 0, sub: 0 }
  const misses = { add: 0, sub: 0 }

  app.register(cache, {
    ttl: 2,
    stale: 2,
    onHit (type, name) {
      hits[name] = hits[name] ? hits[name] + 1 : 1
    },
    onMiss (type, name) {
      misses[name] = misses[name] ? misses[name] + 1 : 1
    },
    policy: {
      Query: {
        add: { ttl: 1, stale: 1 },
        sub: true
      }
    }
  })

  let addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  let subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.add, 0)
  equal(misses.add, 1)
  equal(addCounter, 1)
  same(addData, {
    data: {
      add: 1
    }
  })

  equal(hits.sub, 0)
  equal(misses.sub, 1)
  equal(subCounter, 1)
  same(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(500)

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.add, 1)
  equal(misses.add, 1)
  equal(addCounter, 1)
  same(addData, {
    data: {
      add: 1
    }
  })

  equal(hits.sub, 1)
  equal(misses.sub, 1)
  equal(subCounter, 1)
  same(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(1000)

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.add, 2)
  equal(misses.add, 1)
  equal(addCounter, 2)
  same(addData, {
    data: {
      add: 1
    }
  })

  equal(hits.sub, 2)
  equal(misses.sub, 1)
  equal(subCounter, 1)
  same(subData, {
    data: {
      sub: 1
    }
  })

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.add, 3)
  equal(misses.add, 1)
  equal(addCounter, 2)
  same(addData, {
    data: {
      add: 2
    }
  })

  equal(hits.sub, 3)
  equal(misses.sub, 1)
  equal(subCounter, 1)
  same(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(1000)

  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.sub, 4)
  equal(misses.sub, 1)
  equal(subCounter, 2)
  same(subData, {
    data: {
      sub: 1
    }
  })

  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  equal(hits.sub, 5)
  equal(misses.sub, 1)
  equal(subCounter, 2)
  same(subData, {
    data: {
      sub: 2
    }
  })
})

test('cache different policies with different options / ttl', async ({ equal, teardown }) => {
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
  equal(misses.add, 0, 'never use the cache')

  equal(hits.sub, 0, 'never hits the cache')
  equal(misses.sub, 0, 'never use the cache')
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
