'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')
const split = require('split2')
const FakeTimers = require('@sinonjs/fake-timers')
const { request } = require('./helper')

test('Log cache report with policy specified', async ({ strictSame, plan, fail, teardown }) => {
  plan(2)

  let app = null
  const stream = split(JSON.parse)
  try {
    app = fastify({
      logger: {
        stream: stream
      }
    })
  } catch (e) {
    fail()
  }

  teardown(app.close.bind(app))

  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 10
  })
  teardown(() => clock.uninstall())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
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
    ttl: 1,
    policy: {
      Query: {
        add: true
      }
    },
    logInterval: 1
  })

  const query = '{ add(x: 2, y: 2) }'

  {
    await request({ app, query })

    await clock.tickAsync(1000)
    await once(stream, 'data')
    const { cacheReport } = await once(stream, 'data')

    strictSame(cacheReport, { 'Query.add': { hits: 0, misses: 1 } })
  }

  app.graphql.cache.clear()

  {
    await request({ app, query })
    await request({ app, query })

    await clock.tickAsync(1000)
    await once(stream, 'data')
    const { cacheReport } = await once(stream, 'data')

    strictSame(cacheReport, { 'Query.add': { hits: 1, misses: 1 } })
  }
})

test('Log cache report with all specified', async ({ strictSame, plan, fail, teardown }) => {
  plan(2)

  let app = null
  const stream = split(JSON.parse)
  try {
    app = fastify({
      logger: {
        stream: stream
      }
    })
  } catch (e) {
    fail()
  }

  teardown(app.close.bind(app))

  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 10
  })
  teardown(() => clock.uninstall())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
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
    ttl: 1,
    all: true,
    logInterval: 1
  })

  const query = '{ add(x: 2, y: 2) }'

  {
    await request({ app, query })

    await clock.tickAsync(1000)
    await once(stream, 'data')
    const { cacheReport } = await once(stream, 'data')

    strictSame(cacheReport, { 'Query.add': { hits: 0, misses: 1 } })
  }

  app.graphql.cache.clear()

  {
    await request({ app, query })
    await request({ app, query })

    await clock.tickAsync(1000)
    await once(stream, 'data')
    const { cacheReport } = await once(stream, 'data')

    strictSame(cacheReport, { 'Query.add': { hits: 1, misses: 1 } })
  }
})

test('should not produce a cache report if logInterval not specified', async ({ pass, plan, fail, teardown }) => {
  plan(1)

  let app = null
  const stream = split(JSON.parse)
  try {
    app = fastify({
      logger: {
        stream: stream
      }
    })
  } catch (e) {
    fail()
  }

  teardown(app.close.bind(app))

  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 10
  })
  teardown(() => clock.uninstall())

  const schema = `
    type Query {
      add(x: Int, y: Int): Int
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
    ttl: 1,
    policy: {
      Query: {
        add: true
      }
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  await request({ app, query })

  await once(stream, 'data')

  try {
    await once(stream, 'data') // this should fail as cache report is not logging
    fail('should never reach here')
  } catch (error) {
    pass()
  }
})

function once (emitter, name) {
  return new Promise((resolve, reject) => {
    // If timeout reached then it means cache report is not running
    const timeout = setTimeout(() => {
      emitter.destroy()
      reject(new Error('Timeout reached'))
    }, 2000)
    timeout.unref()
    if (name !== 'error') emitter.once('error', reject)
    emitter.once(name, (...args) => {
      clearTimeout(timeout)
      emitter.removeListener('error', reject)
      resolve(...args)
    })
  })
}
