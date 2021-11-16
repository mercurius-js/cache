'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

const FakeTimers = require('@sinonjs/fake-timers')

test('external cache', async ({ equal, same, pass, plan, teardown }) => {
  plan(8)

  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 40
  })
  teardown(() => clock.uninstall())

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
        pass('add called once')
        return x + y
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers
  })

  const map = new Map()

  app.register(cache, {
    ttl: 1,
    storage: {
      async get (key) {
        pass('get called with ' + key)
        return map.get(key)
      },
      async set (key, value) {
        pass('set called')
        map.set(key, value)
      }
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

  await clock.tickAsync(2000)
  await clock.nextAsync()
  await clock.nextAsync()
  await clock.nextAsync()
  await clock.nextAsync()
  await clock.nextAsync()

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
