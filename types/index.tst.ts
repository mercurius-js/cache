import fastify from 'fastify'
import type { MercuriusPlugin } from 'mercurius'
import { expect } from 'tstyche'
import mercuriusCache, {
  MercuriusCacheContext,
  MercuriusCacheOptions,
  MercuriusCachePolicy,
  MercuriusCacheStorageMemory,
  MercuriusCacheStorageRedis,
  MercuriusCacheStorageType,
  PolicyFieldOptions,
} from './index'

const app = fastify()

const emptyCacheOptions = {}
expect<MercuriusCacheOptions>().type.toBeAssignableFrom(emptyCacheOptions)
app.register(mercuriusCache, emptyCacheOptions)

expect(({} as MercuriusPlugin).cache).type.toBe<MercuriusCacheContext | undefined>()

const queryFieldPolicy = {
  ttl: (result: { shouldCache: boolean }) => result.shouldCache ? 10 : 0,
  stale: 10,
  storage: { type: MercuriusCacheStorageType.MEMORY, options: { size: 1 } },
}

expect<PolicyFieldOptions>().type.toBeAssignableFrom(queryFieldPolicy)

const queryPolicy = {
  Query: {
    add: queryFieldPolicy,
  },
}

expect<MercuriusCachePolicy>().type.toBeAssignableFrom(queryPolicy)

const wrongStorageType = {
  type: 'wrong type'
}

expect<MercuriusCacheStorageType>().type.not.toBeAssignableFrom(wrongStorageType)

const cacheRedisStorage = {
  type: MercuriusCacheStorageType.REDIS,
  options: {
    client: {},
    invalidate: true,
    log: { log: 'storage log' },
  },
}

expect<MercuriusCacheStorageRedis>().type.toBeAssignableFrom(cacheRedisStorage)
expect<MercuriusCacheStorageMemory>().type.not.toBeAssignableFrom(cacheRedisStorage)

const cacheMemoryStorage = {
  type: MercuriusCacheStorageType.MEMORY,
  options: {
    invalidate: true,
    size: 10000,
    log: { log: 'storage log' },
  },
}

expect<MercuriusCacheStorageMemory>().type.toBeAssignableFrom(cacheMemoryStorage)
expect<MercuriusCacheStorageRedis>().type.not.toBeAssignableFrom(cacheMemoryStorage)

const allValidCacheOptions = {
  all: false,
  policy: queryPolicy,
  ttl: () => 1000,
  skip: () => {
    console.log('skip called!')
  },
  storage: cacheMemoryStorage,
  onDedupe: () => {
    console.log('onDedupe called!')
  },
  onHit: () => {
    console.log('onHit called!')
  },
  onMiss: () => {
    console.log('onMiss called!')
  },
  onSkip: () => {
    console.log('onSkip called!')
  },
  onError: () => {
    console.log('onError called!')
  },
  logInterval: 500,
  logReport: () => {
    console.log('log report')
  },
}
expect<MercuriusCacheOptions>().type.toBeAssignableFrom(allValidCacheOptions)
app.register(mercuriusCache, allValidCacheOptions)
