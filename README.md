# mercurius-cache

Adds an in-process caching layer to Mercurius.
Federation is fully supported.

Based on preliminary testing, it is possible to achieve a significant
throughput improvement at the expense of the freshness of the data.
Setting the ttl accordingly and/or a good invalidation strategy is of critical importance.

Under the covers, it uses [`async-cache-dedupe`](https://github.com/mcollina/async-cache-dedupe)
which will also deduplicate the calls.

## Install

```bash
npm i fastify mercurius mercurius-cache graphql
```

## Quickstart

```js
import Fastify from 'fastify'
import mercurius from 'mercurius'
import cache from 'mercurius-cache'

const app = Fastify({ logger: true })

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

await app.register(mercurius, {
  schema,
  resolvers
})

// cache query "add" responses for 10 seconds
await app.register(cache, {
  ttl: 10,
  policy: {
    Query: {
      add: true
      // note: it caches "add" but it does not cache "hello"
    }
  }
})

await app.listen({ port: 3000 })

// Use the following to test
// curl -X POST -H 'content-type: application/json' -d '{ "query": "{ add(x: 2, y: 2) }" }' localhost:3000/graphql
```

## Options

- **ttl**

a number or a function that returns a number of the maximum time a cache entry can live in seconds; default is `0`, which means that the cache is disabled. The ttl function reveives the result of the original function as the first argument.

Example(s) 

```js
  ttl: 10
```

```js
  ttl: (result) => !!result.importantProp ? 10 : 0
```

- **stale**

the time in seconds after the ttl to serve stale data while the cache values are re-validated. Has no effect if `ttl` is not configured.

Example  

```js
  stale: 5
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
    - **invalidation.referencesTTL**: references TTL in seconds. Default is the max static `ttl` between the main one and policies. If all ttls specified are functions then `referencesTTL` will need to be specified explictly.
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

See [https://github.com/mercurius-js/mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) for a complete complex use case.

- **policy**

specify queries to cache; default is empty.  
Set it to `true` to cache using main `ttl` and `stale` if configured.
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
      bye: true, // Query "bye" will be cached for 10 seconds
      hello: (result) => result.shouldCache ? 15 : 0 // function that determines the ttl for how long the item should be cached
    }
  }
```

- **policy~stale**

use a specific `stale` value for the policy, instead of the main one.  
Example  

```js
  ttl: 10,
  stale: 10,
  policy: {
    Query: {
      welcome: {
        ttl: 5 // Query "welcome" will be cached for 5 seconds
        stale: 5 // Query "welcome" will available for 5 seconds after the ttl has expired
      },
      bye: true // Query "bye" will be cached for 10 seconds and available for 10 seconds after the ttl is expired
    }
  }
```

- **policy~storage**

use specific storage for the policy, instead of the main one.  
Can be useful to have, for example, in-memory storage for small data set along with the redis storage.  
See [https://github.com/mercurius-js/mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) for a complete complex use case.  
Example

```js
  storage: {
    type: 'redis',
    options: { client: new Redis() }
  },
  policy: {
    Query: {
      countries: {
        ttl: 86400, // Query "countries" will be cached for 1 day
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

- **policy~key**

To improve performance, we can define a custom key serializer.
Example  

```js
  const schema = `
  type Query {
    getUser (id: ID!): User
  }`

  // ...

  policy: {
    Query: {
      getUser: { key ({ self, arg, info, ctx, fields }) { return `${arg.id}` } }
    }
  }
```

Please note that the `key` function must return a string, otherwise the result will be stringified, losing the performance advantage of custom serialization.

- **policy~extendKey**

extend the key to cache responses by different requests, for example, to enable custom cache per user.  
See [examples/cache-per-user.js](examples/cache-per-user.js).
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

function to set the `references` for the query, see [invalidation](#invalidation) to know how to use references, and [https://github.com/mercurius-js/mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) for a complete use case.  
Example  

```js
  policy: {
    Query: {
      user: {
        references: ({source, args, context, info}, key, result) => {
          if(!result) { return }
          return [`user:${result.id}`]
        }
      },
      users: {
        references: ({source, args, context, info}, key, result) => {
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

function to `invalidate` for the query by references, see [invalidation](#invalidation) to know how to use references, and [https://github.com/mercurius-js/mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) for a complete use case.  
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

- **policy~__options**

should be used in case of conflicts with nested fields with the same name as policy fields (ttl, skip, storage....).  
Example

```js
policy: {
	Query: {
	  welcome: {
	    // no __options key present, so policy options are considered as it is
	    ttl: 6
	  },
	  hello: {
	    // since "hello" query has a ttl property
	    __options: {
	      ttl: 6
	    },
	    ttl: {
	      // here we can use both __options or list policy options
	      skip: () { /* .. */ }
	    }
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
When multiple requests arrive at the same time, the dedupe system calls the resolver only once and serve all the request with the result of the first request - and after the result is cached.  
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

- **onError**

called when an error occurred on the caching operation.
Example  

```js
  onError (type, fieldName, error) {
    console.error(`error on ${type} ${fieldName}`, error)
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
    console.log('Periodic cache report')
    console.table(report)
  }

// console table output

┌───────────────┬─────────┬──────┬────────┬───────┐
│     (index)   │ dedupes │ hits │ misses │ skips │
├───────────────┼─────────┼──────┼────────┼───────┤
│   Query.add   │    0    │  8   │   1    │   0   │
│   Query.sub   │    0    │  2   │   6    │   0   │
└───────────────┴─────────┴──────┴────────┴───────┘

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

## Methods

- **invalidate**

### `cache.invalidate(references, [storage])`

`cache.invalidate` perform invalidation over the whole storage.  
To specify the `storage` to operate invalidation, it needs to be the name of a policy, for example `Query.getUser`.  
Note that `invalidation` must be enabled on `storage`.

`references` can be:

- a single reference
- an array of references (without wildcard)
- a matching reference with wildcard, same logic for `memory` and `redis`

Example

```js
const app = fastify()

await app.register(cache, {
  ttl: 60,
  storage: {
    type: 'redis',
    options: { client: redisClient, invalidation: true    }
  },
  policy: { 
    Query: {
      getUser: {
        references: (args, key, result) => result ? [`user:${result.id}`] : null
      }
    }
  }
})

// ...

// invalidate all users
await app.graphql.cache.invalidate('user:*')

// invalidate user 1
await app.graphql.cache.invalidate('user:1')

// invalidate user 1 and user 2
await app.graphql.cache.invalidate(['user:1', 'user:2'])
```

See [example](/examples/invalidation.js) for a complete example.

- **clear**

`clear` method allows to pragmatically clear the cache entries, for example

```js
const app = fastify()

await app.register(cache, {
  ttl: 60,
  policy: { 
    // ...
  }
})

// ...

await app.graphql.cache.clear()
```

## Invalidation

Along with `time to live` invalidation of the cache entries, we can use invalidation by keys.  
The concept behind invalidation by keys is that entries have an auxiliary key set that explicitly links requests along with their result. These auxiliary keys are called here `references`.  
The use case is common. Let's say we have an entry _user_ `{id: 1, name: "Alice"}`, it may change often or rarely, the `ttl` system is not accurate:

- it can be updated before `ttl` expiration, in this case the old value is shown until expiration by `ttl`.  
It may also be in more queries, for example, `getUser` and `findUsers`, so we need to keep their responses consistent
- it's not been updated during `ttl` expiration, so in this case, we don't need to reload the value, because it's not changed

To solve this common problem, we can use `references`.  
We can say that the result of query `getUser(id: 1)` has reference `user~1`, and the result of query `findUsers`, containing `{id: 1, name: "Alice"},{id: 2, name: "Bob"}` has references `[user~1,user~2]`.
So we can find the results in the cache by their `references`, independently of the request that generated them, and we can invalidate by `references`.

When the mutation `updateUser` involves `user {id: 1}` we can remove all the entries in the cache that have references to `user~1`, so the result of `getUser(id: 1)` and `findUsers`, and they will be reloaded at the next request with the new data - but not the result of `getUser(id: 2)`.

However, the operations required to do that could be expensive and not worthing it, for example, is not recommendable to cache frequently updating data by queries of `find` that have pagination/filtering/sorting.

Explicit invalidation is `disabled` by default, you have to enable in `storage` settings.

See [mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) for a complete example.

### Redis

Using a `redis` storage is the best choice for a shared cache for a cluster of a service instance.  
However, using the invalidation system need to keep `references` updated, and remove the expired ones: while expired references do not compromise the cache integrity, they slow down the I/O operations.  

So, redis storage has the `gc` function, to perform garbage collection.

See this example in [mercurius-cache-example/plugins/cache.js](https://github.com/mercurius-js/mercurius-cache-example/blob/master/plugins/cache.js) about how to run gc on a single instance service.

Another example:

```js
const { createStorage } = require('async-cache-dedupe')
const client = new Redis(connection)

const storage = createStorage('redis', { log, client, invalidation: true })

// run in lazy mode, doing a full db iteration / but not a full clean up
let cursor = 0
do {
  const report = await storage.gc('lazy', { lazy: { chunk: 200, cursor } })
  cursor = report.cursor
} while (cursor !== 0)

// run in strict mode
const report = await storage.gc('strict', { chunk: 250 })

```

In lazy mode, only `options.max` references are scanned every time, picking keys to check randomly; this operation is lighter while does not ensure references full clean up

In strict mode, all references and keys are checked and cleaned; this operation scans the whole db and is slow, while it ensures full references clean up.

`gc` options are:

- **chunk** the chunk size of references analyzed per loops, default `64`
- **lazy~chunk** the chunk size of references analyzed per loops in `lazy` mode, default `64`; if both `chunk` and `lazy.chunk` is set, the maximum one is taken
- **lazy~cursor** the cursor offset, default zero; cursor should be set at `report.cursor` to continue scanning from the previous operation

`storage.gc` function returns the `report` of the job, like

```json
"report":{
  "references":{
      "scanned":["r:user:8", "r:group:11", "r:group:16"],
      "removed":["r:user:8", "r:group:16"]
  },
  "keys":{
      "scanned":["users~1"],
      "removed":["users~1"]
  },
  "loops":4,
  "cursor":0,
  "error":null
}
```

An effective strategy is to run often `lazy` cleans and a `strict` clean sometimes.  
The report contains useful information about the gc cycle, use them to adjust params of the gc utility, settings depending on the size, and the mutability of cached data.

A way is to run it programmatically, as in [https://github.com/mercurius-js/mercurius-cache-example](https://github.com/mercurius-js/mercurius-cache-example) or set up cronjobs as described in [examples/redis-gc](examples/redis-gc) - this one is useful when there are many instances of the mercurius server.  
See [async-cache-dedupe#redis-garbage-collector](https://github.com/mcollina/async-cache-dedupe#redis-garbage-collector) for details.

## Breaking Changes

- version `0.11.0` -> `0.12.0`
  - `options.cacheSize` is dropped in favor of `storage`
  - `storage.get` and `storage.set` are removed in favor of `storage` options

## Benchmarks

We have experienced substantial performance improvements in real-world scenarios, but benchmark numbers depend heavily on the Node.js version, the Mercurius gateway/federation package versions, the machine, and the selected TTL.

This repository includes benchmark fixtures for a gateway and two federated services built with the current split packages:
- `@mercuriusjs/gateway`
- `@mercuriusjs/federation`

Run them with:

```bash
sh bench.sh
```

The gateway benchmark exercises:
- no cache
- cache enabled with `0s`, `1s`, and `10s` TTLs
- default key serialization vs custom key serialization

A recent local run on Node.js `v24.13.0` produced roughly:
- gateway without cache: `~10.5k req/s`
- gateway with `ttl: 0`: `~29.0k req/s`
- gateway with `ttl: 1`: `~25.7k req/s`
- gateway with `ttl: 10`: `~25.5k req/s`
- default key serialization benchmark: `~43.9k req/s`
- custom key serialization benchmark: `~45.5k req/s`

Sample output from `sh bench.sh`:

```text
===============================
= Gateway Mode (not cache)     =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬───────┬─────────┬─────────┬───────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%   │ Avg     │ Stdev   │ Max   │
├─────────┼──────┼──────┼───────┼───────┼─────────┼─────────┼───────┤
│ Latency │ 8 ms │ 9 ms │ 11 ms │ 13 ms │ 8.99 ms │ 1.64 ms │ 77 ms │
└─────────┴──────┴──────┴───────┴───────┴─────────┴─────────┴───────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬───────────┬────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg       │ Stdev  │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Req/Sec   │ 8,967   │ 8,967   │ 10,671  │ 10,871  │ 10,530.55 │ 510.33 │ 8,966   │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Bytes/Sec │ 3.15 MB │ 3.15 MB │ 3.75 MB │ 3.82 MB │ 3.7 MB    │ 179 kB │ 3.15 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴───────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

116k requests in 11.01s, 40.7 MB read

===============================
= Gateway Mode (0s TTL)        =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬───────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max   │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼───────┤
│ Latency │ 2 ms │ 3 ms │ 4 ms  │ 5 ms │ 3.12 ms │ 0.73 ms │ 62 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴───────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev    │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Req/Sec   │ 25,551  │ 25,551  │ 29,407  │ 29,807  │ 28,982.4 │ 1,193.66 │ 25,539  │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Bytes/Sec │ 8.97 MB │ 8.97 MB │ 10.3 MB │ 10.5 MB │ 10.2 MB  │ 419 kB   │ 8.96 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

290k requests in 10.01s, 102 MB read

===============================
= Gateway Mode (1s TTL)        =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 3 ms │ 3 ms │ 5 ms  │ 7 ms │ 3.28 ms │ 1.77 ms │ 207 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev  │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼────────┼─────────┤
│ Req/Sec   │ 22,975  │ 22,975  │ 26,031  │ 26,399  │ 25,733.1 │ 908.05 │ 22,973  │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼────────┼─────────┤
│ Bytes/Sec │ 8.07 MB │ 8.07 MB │ 9.13 MB │ 9.27 MB │ 9.03 MB  │ 318 kB │ 8.06 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

283k requests in 11.01s, 99.3 MB read

===============================
= Gateway Mode (10s TTL)       =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 3 ms │ 3 ms │ 5 ms  │ 7 ms │ 3.28 ms │ 1.39 ms │ 171 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬───────────┬────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg       │ Stdev  │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Req/Sec   │ 23,151  │ 23,151  │ 25,855  │ 25,951  │ 25,532.37 │ 776.18 │ 23,140  │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Bytes/Sec │ 8.12 MB │ 8.12 MB │ 9.08 MB │ 9.11 MB │ 8.96 MB   │ 273 kB │ 8.12 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴───────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

281k requests in 11.01s, 98.6 MB read

*******************************

===============================
= Default Key Serialization    =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 1 ms │ 2 ms │ 4 ms  │ 4 ms │ 2.01 ms │ 1.36 ms │ 174 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬───────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg       │ Stdev    │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼──────────┼─────────┤
│ Req/Sec   │ 39,967  │ 39,967  │ 44,127  │ 44,895  │ 43,861.82 │ 1,299.41 │ 39,942  │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼──────────┼─────────┤
│ Bytes/Sec │ 9.67 MB │ 9.67 MB │ 10.7 MB │ 10.9 MB │ 10.6 MB   │ 317 kB   │ 9.67 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴───────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

483k requests in 11.01s, 117 MB read

===============================
= Custom Key Serialization     =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 1 ms │ 2 ms │ 3 ms  │ 4 ms │ 1.84 ms │ 1.35 ms │ 164 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev    │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Req/Sec   │ 41,311  │ 41,311  │ 45,791  │ 46,367  │ 45,459.2 │ 1,415.65 │ 41,280  │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Bytes/Sec │ 10.2 MB │ 10.2 MB │ 11.4 MB │ 11.5 MB │ 11.3 MB  │ 352 kB   │ 10.2 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

455k requests in 10.01s, 113 MB read
```

There is also a single-server benchmark that isolates the cache effect without gateway/federation overhead. It uses one Mercurius server with a resolver that takes about `100ms` to respond.

Run it with:

```bash
./bench/single-server.sh
```

A recent local run on Node.js `v24.13.0` produced roughly:
- single server without cache: `~971 req/s`, `~101.8ms` average latency
- single server with `ttl: 1`: `~45.4k req/s`, `~1.42ms` average latency
- single server with `ttl: 10`: `~56.1k req/s`, `~1.18ms` average latency

Sample output from `./bench/single-server.sh`:

```text
===============================
= Single server (no cache)  =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬────────┬────────┬────────┬────────┬──────────┬─────────┬────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%  │ 99%    │ Avg      │ Stdev   │ Max    │
├─────────┼────────┼────────┼────────┼────────┼──────────┼─────────┼────────┤
│ Latency │ 100 ms │ 101 ms │ 106 ms │ 114 ms │ 101.8 ms │ 1.97 ms │ 116 ms │
└─────────┴────────┴────────┴────────┴────────┴──────────┴─────────┴────────┘
┌───────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%    │ 97.5%  │ Avg    │ Stdev  │ Min    │
├───────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┤
│ Req/Sec   │ 900    │ 900    │ 991    │ 1,000  │ 970.9  │ 36.72  │ 900    │
├───────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────┤
│ Bytes/Sec │ 238 kB │ 238 kB │ 262 kB │ 264 kB │ 256 kB │ 9.7 kB │ 238 kB │
└───────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

10k requests in 10.02s, 2.56 MB read

===============================
= Single server (ttl: 1)   =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 1 ms │ 1 ms │ 3 ms  │ 3 ms │ 1.42 ms │ 4.86 ms │ 119 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬──────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg      │ Stdev    │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Req/Sec   │ 41,183  │ 41,183  │ 45,887  │ 46,367  │ 45,411.2 │ 1,462.81 │ 41,179  │
├───────────┼─────────┼─────────┼─────────┼─────────┼──────────┼──────────┼─────────┤
│ Bytes/Sec │ 10.9 MB │ 10.9 MB │ 12.1 MB │ 12.2 MB │ 12 MB    │ 384 kB   │ 10.9 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴──────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 10

454k requests in 10.01s, 120 MB read

===============================
= Single server (ttl: 10)  =
===============================
Running 10s test @ http://localhost:3000/graphql
100 connections

┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 1 ms │ 1 ms │ 3 ms  │ 3 ms │ 1.18 ms │ 2.02 ms │ 120 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬───────────┬──────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg       │ Stdev    │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼──────────┼─────────┤
│ Req/Sec   │ 46,719  │ 46,719  │ 57,567  │ 58,175  │ 56,138.19 │ 3,438.28 │ 46,690  │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼──────────┼─────────┤
│ Bytes/Sec │ 12.3 MB │ 12.3 MB │ 15.2 MB │ 15.4 MB │ 14.8 MB   │ 909 kB   │ 12.3 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴───────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

618k requests in 11.01s, 163 MB read
```

Treat these as sample results only; rerun `sh bench.sh` or `./bench/single-server.sh` on your machine after dependency upgrades or benchmark fixture changes.

## More info about how this plugin works
This plugin caches the result of the resolver, but if the resolver returns a type incompatible with the schema return type, the plugin will cache the invalid return value. When you call the resolver again, the plugin will return the cached value, thereby caching the validation error.

This issue may be exacerbated in a federation setup when you don't have full control over the implementation of federated schema and resolvers.

Here you can find an example of the problem.
```js
import Fastify from 'fastify'
import mercurius from 'mercurius'
import cache from 'mercurius-cache'

const app = Fastify({ logger: true })

const schema = `
  type Query {
    getNumber: Int
  }
`

const resolvers = {
  Query: {
    async getNumber (_, __, { reply }) {
      return 'hello'
    }
  }
}

await app.register(mercurius, {
  schema,
  resolvers
})

await app.register(cache, {
  ttl: 10,
  policy: {
    Query: {
      getNumber: true
    }
  }
})
```

If you come across this problem, you will first need to fix your code. Then you have two options:

1. If you are you using an **in-memory** cache, it will be cleared at the next start of the application, so the impact of this issue will be limited
2. If you are you using the **Redis** cache, you will need to manually invalidate the cache in Redis or wait for the TTL to expire

## License

MIT
