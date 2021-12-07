'use strict'

const { test } = require('tap')
const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('..')

const cases = [
  {
    title: 'should get error using all as string',
    options: { all: 'true' },
    expect: /all must be a boolean/
  },
  {
    title: 'should get error using ttl as string',
    options: { ttl: '10' },
    expect: /ttl must be a number greater than 0/
  },
  {
    title: 'should get error using ttl negative',
    options: { ttl: -1 },
    expect: /ttl must be a number greater than 0/
  },
  {
    title: 'should get error using onDedupe as string',
    options: { onDedupe: 'not a function' },
    expect: /onDedupe must be a function/
  },
  {
    title: 'should get error using onHit as string',
    options: { onHit: 'not a function' },
    expect: /onHit must be a function/
  },
  {
    title: 'should get error using onMiss as string',
    options: { onMiss: 'not a function' },
    expect: /onMiss must be a function/
  },
  {
    title: 'should get error using onSkip as string',
    options: { onSkip: 'not a function' },
    expect: /onSkip must be a function/
  },
  {
    title: 'should get error using policy as string',
    options: { policy: 'not an object' },
    expect: /policy must be an object/
  },
  {
    title: 'should get error using logInterval as string',
    options: { logInterval: 'not-a-number' },
    expect: /logInterval must be a number greater than 1/
  },
  {
    title: 'should get error using logReport not a function',
    options: { logReport: 'not a function' },
    expect: /logReport must be a function/
  },
  {
    title: 'should get error using skip not a function',
    options: { skip: 'not a function' },
    expect: /skip must be a function/
  },
  {
    title: 'should get error using policy.storage without any ttl',
    options: { storage: { type: 'memory', options: { ttl: 0 } } },
    expect: /storage is set but no ttl or policy ttl is set/
  },

  // policy options
  {
    title: 'should get error using policy.ttl as string',
    options: { policy: { Query: { add: { ttl: '10' } } } },
    expect: /ttl must be a number greater than 0/
  },
  {
    title: 'should get error using policy.ttl negative',
    options: { policy: { Query: { add: { ttl: -1 } } } },
    expect: /ttl must be a number greater than 0/
  },
  {
    title: 'should get error using policy.extendKey not a function',
    options: { policy: { Query: { add: { extendKey: 'not a function' } } } },
    expect: /policy 'Query.add' extendKey must be a function/
  },
  {
    title: 'should get error using policy.skip not a function',
    options: { policy: { Query: { add: { skip: 'not a function' } } } },
    expect: /policy 'Query.add' skip must be a function/
  },
  {
    title: 'should get error using policy.invalidate not a function',
    options: { policy: { Query: { add: { invalidate: 'not a function' } } } },
    expect: /policy 'Query.add' invalidate must be a function/
  },
  {
    title: 'should get error using policy.references not a function',
    options: { policy: { Query: { add: { references: 'not a function' } } } },
    expect: /policy 'Query.add' references must be a function/
  },
  {
    title: 'should get error using policy.storage not an object',
    options: { policy: { Query: { add: { storage: 'not an object' } } } },
    expect: /policy 'Query.add' storage must be an object/
  },
  {
    title: 'should get error using policy.storage.type allowed',
    options: { policy: { Query: { add: { storage: { type: 'zzz' } } } } },
    expect: /policy 'Query.add' storage type must be memory or redis/
  },
  {
    title: 'should get error using policy.storage.options not an object',
    options: { policy: { Query: { add: { storage: { type: 'memory', options: 'not an object' } } } } },
    expect: /policy 'Query.add' storage options must be an object/
  }
]

for (const useCase of cases) {
  test(useCase.title, async (t) => {
    const app = fastify()

    const schema = 'type Query { add(x: Int, y: Int): Int }'
    const resolvers = {
      Query: {
        async add (_, { x, y }) { return x + y }
      }
    }
    app.register(mercurius, { schema, resolvers })

    await t.rejects(app.register(cache, useCase.options), useCase.expect)
  })
}
