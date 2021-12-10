# mercurius-cache

Adds an in-process caching layer to Mercurius.
Federation is fully supported.

Based on preliminary testing, it is possible to achieve a significant
throughput improvement at the expense of the freshness of the data.
Setting the ttl accordingly and/or a good invalidation strategy is of critical importance.

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

- **all**

use the cache in all resolvers; default is false. Use either `policy` or `all` but not both.  
Example  

```js
  all: true
```

- **storage**

default cache is in `memory`, but a `redis` storage can be used for a larger and shared cache.  
Storage options are:

- **type**: `memory` (default) or `redis`
- **options**: by storage type
  - for `memory`
    - **size**: maximum number of items to store in the cache _per resolver_. Default is `1024`.
    - **invalidation**: enable invalidation, see [documentation](#invalidation). Default is disabled.
    - **log**: logger instance `pino` compatible, default is the `app.log` instance.

    Example  

    ```js
      storage: {
        type: 'memory',
        options: {
          size: 2048
        }
      }
    ```

  - for `redis`
    - **client**: a redis client instance, mandatory. Should be an `ioredis` client or compatible.
    - **invalidation**: enable invalidation, see [documentation](#invalidation). Default is disabled.
    - **invalidation.referencesTTL**: references TTL in seconds. Default is the max `ttl` between the main one and policies.
    - **log**: logger instance `pino` compatible, default is the `app.log` instance.

    Example

    ```js
      storage: {
        type: 'redis',
        options: {
          client: new Redis(),
          invalidation: {
            referencesTTL: 60
          }
        }
      }
    ```

See [examples/full-optional.js](examples/full-optional.js) for a complete complex use case.

- **policy**

specify queries to cache; default is empty.  
Set it to `true` to cache using main `ttl`.
Example  

```js
  policy: {
    Query: {
      add: true
    }
  }
```

- **policy~ttl**

use a specific `ttl` for the policy, instead of the main one.  
Example  

```js
  ttl: 10,
  policy: {
    Query: {
      welcome: {
        ttl: 5 // Query "welcome" will be cached for 5 seconds
      },
      bye: true // Query "bye" will be cached for 10 seconds
    }
  }
```

- **policy~storage**

use a specific storage for the policy, instead of the main one.  
Can be useful to have, for example, an in memory storage for small data set along with the redis storage.  
See [examples/full-optional.js](examples/full-optional.js) for a complete complex use case.  
Example

```js
  storage: {
    type: 'redis',
    options: { client: new Redis() }
  },
  policy: {
    Query: {
      countries: {
        ttl: 1440, // Query "countries" will be cached for 1 day
        storage: { type: 'memory' }
      }
    }
  }
```

- **policy~skip**

skip cache use for a specific condition, `onSkip` will be triggered.  
Example  

```js
  skip (self, arg, ctx, info) {
    if (ctx.reply.request.headers.authorization) {
      return true
    }
    return false
  }
```

- **policy~extendKey**

extend the key to cache responses by different request, for example to enable custom cache per user.  
See [examples/cache-per-user.js](examples/cache-per-user.js) for a complete use case.
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

- **policy~references**

function to set the `references` for the query, see [invalidation](#invalidation) to know how to use references, and [examples/cache-per-user.js](examples/cache-per-user.js) for a complete use case.
Example  

```js
  policy: {
    Query: {
      user: {
        references: (self, arg, ctx, info, result) => {
          if(!result) { return }
          return [`user:${result.id}`]
        }
      },
      users: {
        references: (self, arg, ctx, info, result) => {
          if(!result) { return }
          const references = result.map(user => (`user:${user.id}`))
          references.push('users')
          return references
        }
      }
    }
  }
```

- **policy~invalidate**

function to `invalidate` for the query by references, see [invalidation](#invalidation) to know how to use references, and [examples/cache-per-user.js](examples/cache-per-user.js) for a complete use case.  
`invalidate` function can be sync or async.
Example  

```js
  policy: {
    Mutation: {
      addUser: {
        invalidate: (self, arg, ctx, info, result) => ['users']
      }
    }
  }
```

- **skip**

skip cache use for a specific condition, `onSkip` will be triggered.  
Example  

```js
  skip (self, arg, ctx, info) {
    if (ctx.reply.request.headers.authorization) {
      return true
    }
    return false
  }
```

- **onDedupe**

called when a request is deduped.
When multiple requests arrive at the same time, dedupe system call the resolver only once and serve all the request with the result of the first request - and after the result is cached.  
Example  

```js
  onDedupe (type, fieldName) {
    console.log(`dedupe ${type} ${fieldName}`) 
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

- **logInterval**

This option enables cache report with hit/miss/dedupes/skips count for all queries specified in the policy; default is disabled.
The value of the interval is in *seconds*.  

Example  

```js
  logInterval: 3
```

- **logReport**

custom function for logging cache hits/misses. called every `logInterval` seconds when the cache report is logged.

Example  

```js
  logReport (report) {
    console.log('Periodic cache report', report)
  }

  // report format
  {
    "Query.add": {
      "dedupes": 0,
      "hits": 8,
      "misses": 1,
      "skips": 0
    },
    "Query.sub": {
      "dedupes": 0,
      "hits": 2,
      "misses": 6,
      "skips": 0
    },
  }
```

## Invalidation

Along with `time to live` invalidation of the cache entries, we can use invalidation by keys.  
The concept behind invalidation by keys is that entries have an auxiliary key set that explicitly link requests along with their own result. These axiliary keys are called here `references`.  
The use case is common. Let's say we have an entry _user_ `{id: 1, name: "Alice"}`, it may change often or rarely, the `ttl` system is not accurate:

- it can be updated before `ttl` expiration, this case the old value is showed until expiration by `ttl`.  
It may also be in different queries, for example `getUser` and `findUsers`, so we need to keep their responses consistent
- it's not been updated during `ttl` expiration, so in this case we don't need to reload the value, because it's not changed

To solve this common problem, we can use `references`.  
We can say that the result of query `getUser(id: 1)` has reference `user~1`, and the result of query `findUsers`, containing `{id: 1, name: "Alice"},{id: 2, name: "Bob"}` has references `[user~1,user~2]`.
So we can find the results in the cache by their `references`, independently of the request that generated them, and we can invalidate by `references`.

When the mutation `updateUser` involves `user {id: 1}` we can remove all the entries in the cache that have references to `user~1`, so the result of `getUser(id: 1)` and `findUsers`, and they will be reloaded at the next request with the new data - but not the result of `getUser(id: 2)`.

However, the operations required to do that could be expensive and not worthing it, for example is not recommendable to cache frequently updating data by queries of `find` that have pagination/filtering/sorting.

Explicit invalidation is `disabled` by default, you have to enable in `storage` settings.

See [examples/full-optional.js](examples/full-optional.js) for a complete example.

### Redis

Using a `redis` storage is the best choice for a shared cache for a cluster of a service instance.  
However, using the invalion system need to keep `references` updated, and remove the expired ones: while expired references does not compromise the cache integrity, they slow down the invalidation task.  
We have the utility `bin/redis-gc`, that should be scheduled to run on the same redis instance and db.  

`redis-gc` get configuration by a `.env` file or env vars

- **REDIS_GC_CONNECTION**: connection string for redis, mandatory

- **REDIS_GC_STRATEGY**: `lazy` (default) or `strict`

TODO lazy ...
TODO strict ...

- **REDIS_GC_REFERENCES_TTL**: TODO

Examples

```bash

# run loading .env config file

./bin/redis-gc ../.env

# pass options by env vars

REDIS_GC_STRATEGY=lazy REDIS_GC_CONNECTION=localhost:6379 ./bin/redis-gc

```

Schedule it to run .. TODO N lazy, 1 strict

You can also run gc programmatically by

```js

// TODO

```

## Breaking Changes

TODO move to ..?

- version `0.11.0` -> `0.12.0`
  - `options.cacheSize` is dropped in favor of `storage`
  - `storage.get` and `storage.set` are removed in favor of `storage` options

## Benchmarks

We have experienced up to 10x performance improvements in real-world scenarios.
This repository also include a benchmark of a gateway and two federated services that shows
that adding a cache with 10ms TTL can improve the performance by 4x:

```
$ sh bench.sh
===============================
= Gateway Mode (not cache)    =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬───────┬───────┬───────┬───────┬──────────┬─────────┬────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5% │ 99%   │ Avg      │ Stdev   │ Max    │
├─────────┼───────┼───────┼───────┼───────┼──────────┼─────────┼────────┤
│ Latency │ 28 ms │ 31 ms │ 57 ms │ 86 ms │ 33.47 ms │ 12.2 ms │ 238 ms │
└─────────┴───────┴───────┴───────┴───────┴──────────┴─────────┴────────┘
┌───────────┬────────┬────────┬─────────┬─────────┬─────────┬────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%     │ 97.5%   │ Avg     │ Stdev  │ Min    │
├───────────┼────────┼────────┼─────────┼─────────┼─────────┼────────┼────────┤
│ Req/Sec   │ 1291   │ 1291   │ 3201    │ 3347    │ 2942.1  │ 559.51 │ 1291   │
├───────────┼────────┼────────┼─────────┼─────────┼─────────┼────────┼────────┤
│ Bytes/Sec │ 452 kB │ 452 kB │ 1.12 MB │ 1.17 MB │ 1.03 MB │ 196 kB │ 452 kB │
└───────────┴────────┴────────┴─────────┴─────────┴─────────┴────────┴────────┘

Req/Bytes counts sampled once per second.

32k requests in 11.03s, 11.3 MB read

===============================
= Gateway Mode (0s TTL)       =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
│ Latency │ 6 ms │ 7 ms │ 12 ms │ 17 ms │ 7.29 ms │ 3.32 ms │ 125 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 7403    │ 7403    │ 13359   │ 13751   │ 12759   │ 1831.94 │ 7400    │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 2.59 MB │ 2.59 MB │ 4.68 MB │ 4.81 MB │ 4.47 MB │ 642 kB  │ 2.59 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.

128k requests in 10.03s, 44.7 MB read

===============================
= Gateway Mode (1s TTL)       =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
│ Latency │ 7 ms │ 7 ms │ 13 ms │ 19 ms │ 7.68 ms │ 4.01 ms │ 149 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 6735    │ 6735    │ 12879   │ 12951   │ 12173   │ 1828.86 │ 6735    │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 2.36 MB │ 2.36 MB │ 4.51 MB │ 4.53 MB │ 4.26 MB │ 640 kB  │ 2.36 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.

122k requests in 10.03s, 42.6 MB read

===============================
= Gateway Mode (10s TTL)      =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼────────┤
│ Latency │ 7 ms │ 7 ms │ 13 ms │ 18 ms │ 7.51 ms │ 3.22 ms │ 121 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴────────┘
┌───────────┬────────┬────────┬─────────┬─────────┬─────────┬─────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min    │
├───────────┼────────┼────────┼─────────┼─────────┼─────────┼─────────┼────────┤
│ Req/Sec   │ 7147   │ 7147   │ 13231   │ 13303   │ 12498.2 │ 1807.01 │ 7144   │
├───────────┼────────┼────────┼─────────┼─────────┼─────────┼─────────┼────────┤
│ Bytes/Sec │ 2.5 MB │ 2.5 MB │ 4.63 MB │ 4.66 MB │ 4.37 MB │ 633 kB  │ 2.5 MB │
└───────────┴────────┴────────┴─────────┴─────────┴─────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.

125k requests in 10.03s, 43.7 MB read
```


## License

MIT
