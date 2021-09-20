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

## Quick start

```js
'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const cache = require('mercurius-cache')

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
      for (let i = 0; i < 10000000; i++) {} // something that takes time
      return x + y
    }
  }
}

app.register(mercurius, {
  schema,
  resolvers
})


// cache query "add" responses for 10 seconds
app.register(cache, {
  ttl: 10,
  policy: {
    Query: {
      add: true
      // note: it cache "add" but it doesn't cache "hello"
    }
  }
})

app.listen(3000)

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
```

## Options

- **ttl**

the time to live in seconds, default is zero, which means that the cache is disabled.
Example  

```js
  ttl: 10
```

- **policy**

specify queries to cache; default is empty.  
Example  

```js
  policy: {
    Query: {
      add: true
    }
  }
```

- **policy~extendKey**

extend the key to cache responses by different request, for example to enable custom cache per user; see [example/cache-per-user.js](example/cache-per-user.js) for a complete use case.

```js
  policy: {
    Query: {
      welcome: {
        extendKey: function (source, args, context, info) {
          return context.userId ? `user:${context.userId}` : undefined
        }
      }
    }
  }
```

- **all**

use the cache in all resolvers; default is false. Use either `policy` or `all` but not both.  
Example  

```js
  all: true
```

- **remoteCache**

default cache is in memory, the remote cache is useful for a larger cache. See [example/redis.js](example/redis.js) for a complete use case.  
Example  

```js
  remoteCache: {
    async get (key) {
      // fetch by key from storage
      return storage.get(key)
    },
    async set (key, value) {
      // set the value in the storage
      return storage.set(key, value)
    }
  }
```

- **onHit**

called when a cached value is returned.  
Example  

```js
  onHit (type, fieldName) {
    console.log(`hit ${type} ${fieldName}`) 
  }
```

- **onMiss**

called when there is no value in the cache; it is not called if a resolver is skipped.  
Example  

```js
  onMiss (type, fieldName) {
    console.log(`miss ${type} ${fieldName}`)
  }
```

- **skip**

skip cache use for a specific condition.  
Example  

```js
  skip (self, arg, ctx, info) {
    if (ctx.reply.request.headers.authorization) {
      return true
    }
    return false
  }
```

## License

MIT
