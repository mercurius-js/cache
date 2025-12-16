'use strict'

const { test } = require('node:test')
const FakeTimers = require('@sinonjs/fake-timers')
const { promisify } = require('util')
const Fastify = require('fastify')
const mercurius = require('mercurius')
const { mercuriusFederationPlugin, buildFederationSchema } = require('@mercuriusjs/federation')
const mercuriusGateway = require('@mercuriusjs/gateway')
const mercuriusCache = require('..')
const { buildSchema } = require('graphql')

const immediate = promisify(setImmediate)

test('polling interval with a new schema should trigger refresh of schema policy build', async (t) => {
  const clock = FakeTimers.install({
    shouldAdvanceTime: true,
    advanceTimeDelta: 40,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']
  })
  t.after(() => clock.uninstall())

  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const resolvers = {
    Query: {
      me: (root, args, context, info) => {
        t.assert.ok('resolver called')
        return user
      }
    }
  }

  const userService = Fastify()
  const gateway = Fastify({ logger: { level: 'error' } })
  t.after(async () => {
    await gateway.close()
    await userService.close()
  })

  userService.register(mercuriusFederationPlugin, {
    schema: `
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String
      }
    `,
    resolvers
  })

  await userService.listen({ port: 0 })

  const userServicePort = userService.server.address().port

  await gateway.register(mercuriusGateway, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ],
      pollingInterval: 2000
    }
  })

  await gateway.register(mercuriusCache, {
    ttl: 4242,
    policy: {
      Query: {
        me: true
      }
    }
  })

  async function getMe () {
    const query = `
      query {
        me {
          id
          name
        }
      }
    `

    const res = await gateway.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepStrictEqual(res.json(), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  await getMe()
  await getMe()

  userService.graphql.replaceSchema(
    buildFederationSchema(`
      extend type Query {
        me: User
      }

      type User @key(fields: "id") {
        id: ID!
        name: String 
        lastName: String
      }
    `)
  )
  userService.graphql.defineResolvers(resolvers)

  await clock.tickAsync(2000)

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  async function getMeWithLastName () {
    const query = `
      query {
        me {
          id
          name
          lastName
        }
      }
    `

    const res = await gateway.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepStrictEqual(res.json(), {
      data: {
        me: {
          id: 'u1',
          name: 'John',
          lastName: 'Doe'
        }
      }
    })
  }

  await getMeWithLastName()
  await getMeWithLastName()
})

test('adds a mercuriusCache.refresh() method', async (t) => {
  const user = {
    id: 'u1',
    name: 'John',
    lastName: 'Doe'
  }

  const resolvers = {
    Query: {
      me: (root, args, context, info) => {
        t.assert.ok('resolver called')
        return user
      }
    }
  }

  const userService = Fastify()
  t.after(async () => {
    await userService.close()
  })

  userService.register(mercurius, {
    schema: `
      type Query {
        me: User
      }

      type User {
        id: ID!
        name: String
      }
    `,
    resolvers
  })

  userService.register(mercuriusCache, {
    ttl: 4242,
    policy: {
      Query: {
        me: true
      }
    }
  })

  async function getMe () {
    const query = `
      query {
        me {
          id
          name
        }
      }
    `

    const res = await userService.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepEqual(res.json(), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  await getMe()
  await getMe()

  userService.graphql.replaceSchema(buildSchema(`
      type Query {
        me: User
      }

      type User {
        id: ID!
        name: String 
        lastName: String
      }
    `)
  )
  userService.graphql.defineResolvers(resolvers)

  // This is the new method added by this module
  userService.graphql.cache.refresh()

  // We need the event loop to actually spin twice to
  // be able to propagate the change
  await immediate()
  await immediate()

  async function getMeWithLastName () {
    const query = `
      query {
        me {
          id
          name
          lastName
        }
      }
    `

    const res = await userService.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepStrictEqual(res.json(), {
      data: {
        me: {
          id: 'u1',
          name: 'John',
          lastName: 'Doe'
        }
      }
    })
  }

  await getMeWithLastName()
  await getMeWithLastName()
})
