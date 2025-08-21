'use strict'

const { test } = require('node:test')
const fastify = require('fastify')
const mercurius = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const cache = require('..')

const { request } = require('./helper')

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

test('different cache while revalidate options for policies', async (t) => {
  t.plan(40)

  const app = fastify()
  t.after(() => app.close())

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

  t.assert.strictEqual(hits.add, 0)
  t.assert.strictEqual(misses.add, 1)
  t.assert.strictEqual(addCounter, 1)
  t.assert.deepStrictEqual(addData, {
    data: {
      add: 1
    }
  })

  t.assert.strictEqual(hits.sub, 0)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 1)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(500)

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.add, 1)
  t.assert.strictEqual(misses.add, 1)
  t.assert.strictEqual(addCounter, 1)
  t.assert.deepStrictEqual(addData, {
    data: {
      add: 1
    }
  })

  t.assert.strictEqual(hits.sub, 1)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 1)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(1000)

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.add, 2)
  t.assert.strictEqual(misses.add, 1)
  t.assert.strictEqual(addCounter, 2)
  t.assert.deepStrictEqual(addData, {
    data: {
      add: 1
    }
  })

  t.assert.strictEqual(hits.sub, 2)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 1)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 1
    }
  })

  addData = await request({ app, query: '{ add(x: 1, y: 1) }' })
  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.add, 3)
  t.assert.strictEqual(misses.add, 1)
  t.assert.strictEqual(addCounter, 2)
  t.assert.deepStrictEqual(addData, {
    data: {
      add: 2
    }
  })

  t.assert.strictEqual(hits.sub, 3)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 1)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 1
    }
  })

  clock.tick(1000)

  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.sub, 4)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 2)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 1
    }
  })

  subData = await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.sub, 5)
  t.assert.strictEqual(misses.sub, 1)
  t.assert.strictEqual(subCounter, 2)
  t.assert.deepStrictEqual(subData, {
    data: {
      sub: 2
    }
  })
})

test('cache different policies with different options / dynamic ttl', async (t) => {
  t.plan(4)
  const app = fastify()
  t.after(() => app.close())

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
        add: { ttl: () => 1 },
        sub: { ttl: () => 2 }
      }
    }
  })

  await request({ app, query: '{ add(x: 1, y: 1) }' })
  await request({ app, query: '{ sub(x: 2, y: 2) }' })

  await clock.tick(500)
  await request({ app, query: '{ add(x: 1, y: 1) }' })

  await clock.tick(2000)
  await request({ app, query: '{ sub(x: 2, y: 2) }' })

  t.assert.strictEqual(hits.add, 1)
  t.assert.strictEqual(misses.add, 1)

  t.assert.strictEqual(hits.sub, 0)
  t.assert.strictEqual(misses.sub, 2)
})

test('cache different policies with different options / ttl', async (t) => {
  t.plan(4)
  const app = fastify()
  t.after(() => app.close())

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

  t.assert.strictEqual(hits.add, 1)
  t.assert.strictEqual(misses.add, 1)

  t.assert.strictEqual(hits.sub, 0)
  t.assert.strictEqual(misses.sub, 2)
})

test('cache different policies with different options / storage', async (t) => {
  t.plan(4)
  const app = fastify()
  t.after(() => app.close())

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

  t.assert.strictEqual(hits.add, 0, 'never hits the cache')
  t.assert.strictEqual(misses.add, 0, 'never use the cache')

  t.assert.strictEqual(hits.sub, 0, 'never hits the cache')
  t.assert.strictEqual(misses.sub, 0, 'never use the cache')
})

test('cache different policies with different options / skip', async (t) => {
  t.plan(9)
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

  t.assert.strictEqual(hits.add, 0)
  t.assert.strictEqual(misses.add, 0)
  t.assert.strictEqual(skips.add, 3, 'always skipped')

  t.assert.strictEqual(hits.sub, 2, 'regular from cache')
  t.assert.strictEqual(misses.sub, 2)
  t.assert.strictEqual(skips.sub, 0)

  t.assert.strictEqual(hits.mul, 0)
  t.assert.strictEqual(misses.mul, 1)
  t.assert.strictEqual(skips.mul, 1, 'skipped if first arg > 9')
})

test('cache per user using extendKey option', async (t) => {
  t.plan(20)
  const app = fastify()
  t.after(() => app.close())

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

      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(res.json(), {
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

      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(res.json(), {
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

      t.assert.strictEqual(res.statusCode, 200)
      t.assert.deepStrictEqual(res.json(), {
        data: {
          hello: 'Hello bob'
        }
      })
    }
  }

  t.assert.strictEqual(misses, 3)
  t.assert.strictEqual(hits, 6)
})
