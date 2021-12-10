// See [examples/full-optional.js](examples/full-optional.js) for a complete complex use case
// redis + invalidation + gc
// different storages per policy

// TODO bin for redis.gc + args
// TODO examples: basic, redis, invalidation, references, gc, different storages/ttl per policy

// TODO

// setup redis gc

// let gcIntervalLazy, gcIntervalStrict
// app.addHook('onReady', async () => {
//   gcIntervalLazy = setInterval(() => {
//     app.graphql.cache.storage.gc('lazy', { chunk: 50 })
//   }, app.graphql.cache.storage.referencesTTL).unref()

//   gcIntervalStrict = setInterval(() => {
//     app.graphql.cache.storage.gc('strict')
//   }, app.graphql.cache.storage.referencesTTL * 10).unref()
// })

// app.addHook('onClose', async () => {
//   clearInterval(gcIntervalLazy)
//   clearInterval(gcIntervalStrict)
// })
