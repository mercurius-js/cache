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
    advanceTimeDelta: 100
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

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 1, misses: 1, skips: 0 } })

  await clock.tick(3000)

  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 0, misses: 0, skips: 0 } })
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
    advanceTimeDelta: 100
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

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 1, misses: 1, skips: 0 } })

  await clock.tickAsync(3000)
  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 0, misses: 0, skips: 0 } })
})

test('Log skips correctly', async ({ strictSame, plan, fail, teardown }) => {
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
    advanceTimeDelta: 100
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
    logInterval: 3,
    skip: (self, arg, ctx, info) => {
      return true
    }
  })

  const query = '{ add(x: 2, y: 2) }'

  let data
  await request({ app, query })
  await request({ app, query })

  await clock.tickAsync(1000)
  await once(stream, 'data')

  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 0, misses: 0, skips: 2 } })

  await clock.tickAsync(3000)
  data = await once(stream, 'data')

  strictSame(data.cacheReport, { 'Query.add': { dedupes: 0, hits: 0, misses: 0, skips: 0 } })
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
    advanceTimeDelta: 100
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
  await clock.nextAsync()

  await once(stream, 'data')
  await once(stream, 'data')
})

function once (emitter, name) {
  return new Promise((resolve, reject) => {
    if (name !== 'error') emitter.once('error', reject)
    emitter.once(name, (...args) => {
      emitter.removeListener('error', reject)
      resolve(...args)
    })
  })
}
