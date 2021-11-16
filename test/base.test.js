'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

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

test('cache a nested resolver with loaders', async ({ same, pass, plan, teardown }) => {
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
      Dog: {
        owner: true
      },
      Query: {
        dogs: true
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

test('cache all resolvers', async ({ same, pass, plan, teardown }) => {
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

test('skip the cache if operation is Mutation', async ({ equal, same, teardown }) => {
  const app = fastify()
  teardown(app.close.bind(app))
  let skipCount = 0
  let hitCount = 0

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
    onSkip (type, name) {
      equal(type, 'Mutation')
      equal(name, 'add')
      skipCount++
    },
    onHit (type, name) {
      equal(type, 'Mutation')
      equal(name, 'add')
      hitCount++
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

  equal(skipCount, 0)
  equal(hitCount, 0)
})
