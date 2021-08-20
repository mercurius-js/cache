# mercurius-cache

Adds an in-process caching layer to Mercurius.
Federation is fully supported.

Based on preliminary testing, it is possible to achieve a significant
throughput improvement at the expense of the freshness of the data.
Setting the ttl accordingly is of critical importance.

Under the covers it uses [`async-cache-dedupe`](https://github.com/mcollina/async-cache-dedupe)
which will also deduplicate the calls.

## Install

```bash
npm i fastify mercurius mercurius-cache
```

## Usage

```js
'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('.')

const app = fastify({ logger: true })

const schema = `
  type Query {
    add(x: Int, y: Int): Int
    hello: String
  }
`

const resolvers = {
  Query: {
    async add (_, { x, y }, { reply }) {
      reply.log.info('add called')
      for (let i = 0; i < 10000000; i++) {}
      return x + y
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})

app.register(cache, {
  // all: true, // install the cache in all resolvers
  // ttl: 10, // cache deta in process for ten seconds, default 0
  remoteCache: {
    // The remote cache is useful as a larger cache
    async get (key) {
      return ... // fetch a key from Redis
    },
    async set (key, value) {
      // set the value in Redis
    }
  },
  onHit (type, fieldName) {
    // Called when a cached value is returned
  },
  onMiss (type, fieldName) {
    // Called when there is no value in the cache
    // It is not called if a resolver is skipped
  },
  // Useful to skip the cache for authenticated users or in some other condition
  skip (self, arg, ctx, info) {
    if (ctx.reply.request.headers.authorization) {
      return true
    }
    return false
  }
  policy: {
    Query: {
      add: true
    }
  }
})

app.listen(3000)

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
```

## License

MIT
