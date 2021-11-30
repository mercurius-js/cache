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
    logInterval: 3
  })

  const query = '{ add(x: 2, y: 2) }'

  let data
  await request({ app, query })
  await request({ app, query })

  await clock.tickAsync(1000)
  await once(stream, 'data')

  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { hits: 1, misses: 1 } })

  await clock.tick(3000)
  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { hits: 0, misses: 0 } })
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
    logInterval: 3
  })

  const query = '{ add(x: 2, y: 2) }'

  let data
  await request({ app, query })
  await request({ app, query })

  await clock.tickAsync(1000)
  await once(stream, 'data')

  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { hits: 1, misses: 1 } })

  await clock.tickAsync(3000)
  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { hits: 0, misses: 0 } })
})

test('should not produce a cache report if logInterval not specified', async ({ pass, plan, endAll, fail, teardown }) => {
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
    await once(stream, 'data', 1000) // this should fail as cache report is not logging
    fail('should never reach here')
  } catch (error) {
    pass()
  }
  endAll()
})

test('Log cache report using custom logReport function', async ({ type, plan, endAll, fail, teardown }) => {
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
    all: true,
    logInterval: 1,
    logReport: (report) => {
      type(report['Query.add'], 'object')
      endAll()
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  await request({ app, query })
  await clock.tickAsync(1000)

  await once(stream, 'data')
  await once(stream, 'data')
})

function once (emitter, name, timeout) {
  return new Promise((resolve, reject) => {
    // If timeout reached then it means cache report is not running
    let timer
    if (timeout) {
      timer = setTimeout(() => {
        emitter.destroy()
        reject(new Error('Timeout reached'))
      }, timeout)
      timer.unref()
    }

    if (name !== 'error') emitter.once('error', reject)
    emitter.once(name, (...args) => {
      if (timer) clearTimeout(timer)
      emitter.removeListener('error', reject)
      resolve(...args)
    })
  })
}
