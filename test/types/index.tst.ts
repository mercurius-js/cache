import fastify from 'fastify'
import {
  MercuriusCacheOptions,
  MercuriusCachePolicy,
  PolicyFieldOptions,
  MercuriusCacheStorageMemory,
  MercuriusCacheStorageRedis,
  MercuriusCacheContext,
  MercuriusCacheStorageType,
} from '../../index'
import type { MercuriusPlugin } from 'mercurius'
import { expect } from 'tstyche'
import mercuriusCache from '../../index'

const app = fastify()

const emptyCacheOptions = {}
expect(emptyCacheOptions).type.toBeAssignableTo<MercuriusCacheOptions>()
app.register(mercuriusCache, emptyCacheOptions)

expect(({} as MercuriusPlugin).cache).type.toBeAssignableTo<MercuriusCacheContext | undefined>()

const queryFieldPolicy = {
  ttl: (result: { shouldCache: boolean }) => result.shouldCache ? 10 : 0,
  stale: 10,
  storage: { type: MercuriusCacheStorageType.MEMORY, options: { size: 1 } },
}

expect(queryFieldPolicy).type.toBeAssignableTo<PolicyFieldOptions>()

const queryPolicy = {
  Query: {
    add: queryFieldPolicy,
  },
}

expect(queryPolicy).type.toBeAssignableTo<MercuriusCachePolicy>()

const wrongStorageType = {
  type: 'wrong type'
}

expect(wrongStorageType).type.not.toBeAssignableTo<MercuriusCacheStorageType>()

const cacheRedisStorage = {
  type: MercuriusCacheStorageType.REDIS,
  options: {
    client: {},
    invalidate: true,
    log: { log: 'storage log' },
  },
}

expect(cacheRedisStorage).type.toBeAssignableTo<MercuriusCacheStorageRedis>()
expect(cacheRedisStorage).type.not.toBeAssignableTo<MercuriusCacheStorageMemory>()

const cacheMemoryStorage = {
  type: MercuriusCacheStorageType.MEMORY,
  options: {
    invalidate: true,
    size: 10000,
    log: { log: 'storage log' },
  },
}

expect(cacheMemoryStorage).type.toBeAssignableTo<MercuriusCacheStorageMemory>()
expect(cacheMemoryStorage).type.not.toBeAssignableTo<MercuriusCacheStorageRedis>()

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
expect(allValidCacheOptions).type.toBeAssignableTo<MercuriusCacheOptions>()
app.register(mercuriusCache, allValidCacheOptions)

expect(({} as MercuriusPlugin).cache).type.toBeAssignableTo<MercuriusCacheContext | undefined>()
