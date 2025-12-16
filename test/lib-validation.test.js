'use strict'

const { test } = require('node:test')
const { validateOpts } = require('../lib/validation')

test('should get default options', async (t) => {
  const app = { log: 'the-logger' }
  const options = validateOpts(app)
  t.assert.deepStrictEqual(options.storage, { type: 'memory' })
  t.assert.strictEqual(options.ttl, 0)
  t.assert.strictEqual(options.all, undefined)
  t.assert.strictEqual(options.policy, undefined)
  t.assert.strictEqual(options.skip, undefined)
  t.assert.strictEqual(options.logInterval, undefined)
  t.assert.strictEqual(options.logReport, undefined)
  t.assert.strictEqual(typeof options.onDedupe, 'function')
  t.assert.strictEqual(typeof options.onHit, 'function')
  t.assert.strictEqual(typeof options.onMiss, 'function')
  t.assert.strictEqual(typeof options.onSkip, 'function')
  t.assert.strictEqual(typeof options.onError, 'function')
})

test('should get default options with log object', async (t) => {
  const app = {
    log: { debug }
  }
  const options = validateOpts(app)
  t.assert.deepStrictEqual(options.storage, { type: 'memory' })
  t.assert.strictEqual(options.ttl, 0)
  t.assert.strictEqual(options.all, undefined)
  t.assert.strictEqual(options.policy, undefined)
  t.assert.strictEqual(options.skip, undefined)
  t.assert.strictEqual(options.logInterval, undefined)
  t.assert.strictEqual(options.logReport, undefined)
  t.assert.strictEqual(typeof options.onDedupe, 'function')
  t.assert.strictEqual(typeof options.onHit, 'function')
  t.assert.strictEqual(typeof options.onMiss, 'function')
  t.assert.strictEqual(typeof options.onSkip, 'function')
  t.assert.strictEqual(typeof options.onError, 'function')
  // Trigger options.onError to be tested on callback at top
  const except = {
    prefix: 'Query',
    fieldName: 'add',
    err: 'Error',
    msg: 'Mercurius cache error'
  }
  options.onError(except.prefix, except.fieldName, except.err)
  function debug (params) {
    t.assert.deepStrictEqual(params, except)
  }
})

test('should get default storage.options', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'memory' },
    all: true
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.assert.deepStrictEqual(storage.options, { log: 'the-logger' })
})

test('should get default storage.options, with logger', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'memory', options: { log: 'the-logger' } },
    all: true
  }
  const app = { log: 'another-logger' }
  const { storage } = validateOpts(app, options)
  t.assert.deepStrictEqual(storage.options, { log: 'the-logger' })
})

test('should get default storage.options.invalidation.referencesTTL as max of policies and main ttl / invalidation as boolean true', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidation: true } },
    policy: {
      Query: {
        a: { ttl: 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: 5, storage: { type: 'redis', options: { client: {} } } },
        e: { storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)

  t.assert.strictEqual(storage.options.invalidation.referencesTTL, 6)
})

test('should get default storage.options.invalidation.referencesTTL as max of policies and main ttl / invalidation as empty object', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidation: true } },
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

  t.assert.strictEqual(storage.options.invalidation.referencesTTL, 6)
})

test('should not default storage.options.invalidation.referencesTTL when all ttls are functions / invalidation as boolean true', async (t) => {
  const options = {
    ttl: () => 1,
    storage: { type: 'redis', options: { client: {}, invalidation: true } },
    policy: {
      Query: {
        a: { ttl: () => 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: () => 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: () => 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: () => 5, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  t.assert.throws(() => {
    validateOpts(app, options)
  }, '')
})

test('should not default storage.options.invalidation.referencesTTL when all ttls are functions / invalidation as empty object', async (t) => {
  const options = {
    ttl: () => 1,
    storage: { type: 'redis', options: { client: {}, invalidation: {} } },
    policy: {
      Query: {
        a: { ttl: () => 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: () => 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: () => 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: () => 5, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  t.assert.throws(() => {
    validateOpts(app, options)
  }, '')
})

test('should default storage.options.invalidation.referencesTTL to max ttl when a mix of static and dynamic ttls are configured / invalidation as boolean true', async (t) => {
  const options = {
    ttl: () => 1,
    storage: { type: 'redis', options: { client: {}, invalidation: true } },
    policy: {
      Query: {
        a: { ttl: () => 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: () => 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: 1, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.assert.strictEqual(storage.options.invalidation.referencesTTL, 4)
})

test('should use explicitly defined referencesTTL', async (t) => {
  const options = {
    ttl: () => 1,
    storage: { type: 'redis', options: { client: {}, invalidation: { referencesTTL: 6 } } },
    policy: {
      Query: {
        a: { ttl: () => 2, storage: { type: 'redis', options: { client: {} } } },
        b: { ttl: 3, storage: { type: 'redis', options: { client: {} } } },
        c: { ttl: () => 4, storage: { type: 'redis', options: { client: {} } } },
        d: { ttl: 1, storage: { type: 'redis', options: { client: {} } } }
      }
    }
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.assert.strictEqual(storage.options.invalidation.referencesTTL, 6)
})

test('should get default storage.options.log as app.log', async (t) => {
  const options = {
    ttl: 1,
    storage: { type: 'redis', options: { client: {}, invalidation: true } },
    all: true
  }
  const app = { log: 'the-logger' }
  const { storage } = validateOpts(app, options)
  t.assert.strictEqual(storage.options.log, 'the-logger')
})

test('should not throw error when "__options" is used with valid parameters', async (t) => {
  const options = {
    policy: {
      Query: {
        a: {
          __options: {
            ttl: 2,
            stale: 10,
            storage: { type: 'redis', options: { client: {} } },
            extendKey: () => {},
            skip: () => {},
            invalidate: () => {},
            references: () => {}
          }
        },
        b: {
          __options: {
            ttl: () => 10
          }
        }
      }
    }
  }

  const app = { log: 'the-logger' }
  t.assert.doesNotThrow(() => validateOpts(app, options))
})

const cases = [
  {
    title: 'should get error using all as string',
    options: { all: 'true' },
    expect: /all must be a boolean/
  },
  {
    title: 'should get error using all and policy',
    options: { all: true, policy: {} },
    expect: /policy and all options are exclusive/
  },
  {
    title: 'should get error using ttl as string',
    options: { ttl: '10' },
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using ttl negative',
    options: { ttl: -1 },
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using ttl NaN',
    options: { ttl: NaN },
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using stale as string',
    options: { stale: '10' },
    expect: /stale must be a number greater than 0/
  },
  {
    title: 'should get error using stale negative',
    options: { stale: -1 },
    expect: /stale must be a number greater than 0/
  },
  {
    title: 'should get error using stale NaN',
    options: { stale: NaN },
    expect: /stale must be a number greater than 0/
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
    title: 'should get error using onError as string',
    options: { onError: 'not a function' },
    expect: /onError must be a function/
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
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using policy.ttl negative',
    options: { policy: { Query: { add: { ttl: -1 } } } },
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using policy.ttl NaN',
    options: { policy: { Query: { add: { ttl: NaN } } } },
    expect: /ttl must be a function or a number greater than 0/
  },
  {
    title: 'should get error using policy.stale as string',
    options: { policy: { Query: { add: { stale: '10' } } } },
    expect: /stale must be a number greater than 0/
  },
  {
    title: 'should get error using policy.stale negative',
    options: { policy: { Query: { add: { stale: -1 } } } },
    expect: /stale must be a number greater than 0/
  },
  {
    title: 'should get error using policy.stale NaN',
    options: { policy: { Query: { add: { stale: NaN } } } },
    expect: /stale must be a number greater than 0/
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
  },
  {
    title: 'should get error using policy.key not a function',
    options: { policy: { Query: { add: { key: 'not a function' } } } },
    expect: /policy 'Query.add' key must be a function/
  },
  {
    title: 'should get error using policy.key along with policy.extendKey',
    options: { policy: { Query: { add: { key: () => {}, extendKey: () => {} } } } },
    expect: /policy 'Query.add' key and extendKey are exclusive/
  }
]

for (const useCase of cases) {
  test(useCase.title, async (t) => {
    t.assert.throws(() => validateOpts({}, useCase.options), useCase.expect)
  })
}
