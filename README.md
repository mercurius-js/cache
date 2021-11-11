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

the time to live in seconds; default is `0`, which means that the cache is disabled.
Example  

```js
  ttl: 10
```

- **cacheSize**

the maximum amount of entries to fit in the cache for each query, default `1024`.
Example  

```js
  cacheSize: 2048
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

extend the key to cache responses by different request, for example to enable custom cache per user; see [examples/cache-per-user.js](examples/cache-per-user.js) for a complete use case.
Example  

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

- **policy~ttl**

use a specific ttl for the policy, instead of the default one.  
Example  

```js
  ttl: 10,
  policy: {
    Query: {
      welcome: {
        ttl: 5
      }
    }
  }
```

- **policy~cacheSize**

use a specific cacheSize for the policy, instead of the default one.  
Example  

```js
  policy: {
    cacheSize: 2048,
    Query: {
      welcome: {
        cacheSize: 1024
      }
    }
  }
```

- **policy~skip**

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

- **all**

use the cache in all resolvers; default is false. Use either `policy` or `all` but not both.  
Example  

```js
  all: true
```

- **storage**

default cache is in memory, but a different storage can be used for a larger cache. See [examples/redis.js](examples/redis.js) for a complete use case.  
Example  

```js
  storage: {
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

- **onSkip**

called when the resolver is skipped, both by `skip` or `policy.skip`.
Example  

```js
  onSkip (type, fieldName) {
    console.log(`skip ${type} ${fieldName}`)
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

## Benchmarks

We have experienced up to 10x performance improvements in real-world scenarios.
This repository also include a benchmark of a gateway and two federated services that shows
that adding a cache with 10ms TTL can improve the performance by 4x:

```
===============================
= Gateway Mode (10ms TTL)     =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
│ Latency │ 7 ms │ 7 ms │ 14 ms │ 18 ms │ 7.72 ms │ 2.83 ms │ 105 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
│ Req/Sec   │ 7839    │ 7839    │ 12831   │ 13183   │ 12172.91 │ 1517.09 │ 7836    │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
│ Bytes/Sec │ 2.74 MB │ 2.74 MB │ 4.49 MB │ 4.62 MB │ 4.26 MB  │ 531 kB  │ 2.74 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.

134k requests in 11.03s, 46.9 MB read
===============================
= Gateway Mode (1000ms TTL)   =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
│ Latency │ 7 ms │ 7 ms │ 13 ms │ 17 ms │ 7.66 ms │ 2.77 ms │ 105 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
│ Req/Sec   │ 7955    │ 7955    │ 12967   │ 13231   │ 12248.91 │ 1457.91 │ 7952    │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼─────────┼─────────┤
│ Bytes/Sec │ 2.78 MB │ 2.78 MB │ 4.54 MB │ 4.63 MB │ 4.29 MB  │ 511 kB  │ 2.78 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.

135k requests in 11.03s, 47.2 MB read
===============================
= Gateway Mode (10000ms TTL)   =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev  │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼────────┼────────┤
│ Latency │ 7 ms │ 7 ms │ 14 ms │ 18 ms │ 7.69 ms │ 2.9 ms │ 102 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg    │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼────────┼─────────┼─────────┤
│ Req/Sec   │ 8059    │ 8059    │ 12999   │ 13375   │ 12278  │ 1506.49 │ 8058    │
├───────────┼─────────┼─────────┼─────────┼─────────┼────────┼─────────┼─────────┤
│ Bytes/Sec │ 2.82 MB │ 2.82 MB │ 4.55 MB │ 4.68 MB │ 4.3 MB │ 527 kB  │ 2.82 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.

135k requests in 11.03s, 47.3 MB read
===============================
= Gateway Mode (not cache)    =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬───────┬───────┬───────┬───────┬──────────┬──────────┬────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5% │ 99%   │ Avg      │ Stdev    │ Max    │
├─────────┼───────┼───────┼───────┼───────┼──────────┼──────────┼────────┤
│ Latency │ 27 ms │ 30 ms │ 66 ms │ 80 ms │ 33.14 ms │ 12.28 ms │ 203 ms │
└─────────┴───────┴───────┴───────┴───────┴──────────┴──────────┴────────┘
┌───────────┬────────┬────────┬─────────┬────────┬─────────┬────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%     │ 97.5%  │ Avg     │ Stdev  │ Min    │
├───────────┼────────┼────────┼─────────┼────────┼─────────┼────────┼────────┤
│ Req/Sec   │ 1373   │ 1373   │ 3255    │ 3413   │ 2971.2  │ 588.8  │ 1373   │
├───────────┼────────┼────────┼─────────┼────────┼─────────┼────────┼────────┤
│ Bytes/Sec │ 481 kB │ 481 kB │ 1.14 MB │ 1.2 MB │ 1.04 MB │ 206 kB │ 481 kB │
└───────────┴────────┴────────┴─────────┴────────┴─────────┴────────┴────────┘

Req/Bytes counts sampled once per second.

30k requests in 10.03s, 10.4 MB read
```

## License

MIT
