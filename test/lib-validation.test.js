'use strict'

const { test } = require('tap')
const { validateOpts } = require('../lib/validation')

test('should get default options', async (t) => {
  const app = { log: 'the-logger' }
  const options = validateOpts(app)
  t.same(options.storage, { type: 'memory' })
  t.equal(options.ttl, 0)
  t.equal(options.all, undefined)
  t.equal(options.policy, undefined)
  t.equal(options.skip, undefined)
  t.equal(options.logInterval, undefined)
  t.equal(options.logReport, undefined)
  t.equal(typeof options.onDedupe, 'function')
  t.equal(typeof options.onHit, 'function')
  t.equal(typeof options.onMiss, 'function')
  t.equal(typeof options.onSkip, 'function')
})

test('should get default storage.options', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'memory' },
    all: true
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.same(storage.options, { log: 'the-logger' })
})

test('should get default storage.options, with logger', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'memory', options: { log: 'the-logger' } },
    all: true
  }
  const app = { log: 'another-logger' }
  const { storage } = validateOpts(app, options)
  t.same(storage.options, { log: 'the-logger' })
})

test('should get default storage.options.invalidate.referencesTTL as max of policies and main ttl / invalidation as boolean true', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidate: true } },
    policy: {
      Query: {
        a: { ttl: 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: 5, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)

  t.equal(storage.options.invalidate.referencesTTL, 5)
})

test('should get default storage.options.invalidate.referencesTTL as max of policies and main ttl / invalidation as empty object', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidate: {} } },
    policy: {
      Query: {
        a: { ttl: 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: 5, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)

  t.equal(storage.options.invalidate.referencesTTL, 5)
})

test('should get default storage.options.log as app.log', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidate: true } },
    all: true
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.equal(storage.options.log, 'the-logger')
})

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
    title: 'should get error using storage without any ttl',
    options: { storage: { type: 'memory', options: { ttl: 0 } } },
    expect: /storage is set but no ttl or policy ttl is set/
  },
  {
    title: 'should get error using storage type must be memory or redis',
    options: { ttl: 1, storage: { type: 'zzz' } },
    expect: /storage type must be memory or redis/
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
    t.throws(() => validateOpts({}, useCase.options), useCase.expect)
  })
}
