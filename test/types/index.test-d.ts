import fastify from "fastify";
import {
  MercuriusCacheOptions,
  MercuriusCachePolicy,
  PolicyFieldOptions,
  MercuriusCacheStorageMemory,
  MercuriusCacheStorageRedis,
  MercuriusCacheContext,
  MercuriusCacheStorageType,
} from "../../index";
import { expectAssignable, expectNotAssignable } from "tsd";
import mercuriusCache from "../../index";

const app = fastify();

const emptyCacheOptions = {};
expectAssignable<MercuriusCacheOptions>(emptyCacheOptions);
app.register(mercuriusCache, emptyCacheOptions);

expectAssignable<MercuriusCacheContext | undefined>(app.graphql.cache)

const queryFieldPolicy = {
  ttl: (result: { shouldCache: boolean }) => result.shouldCache ? 10 : 0,
  stale: 10,
  storage: { type: MercuriusCacheStorageType.MEMORY, options: { size: 1 } },
};

expectAssignable<PolicyFieldOptions>(queryFieldPolicy);

const queryPolicy = {
  Query: {
    add: queryFieldPolicy,
  },
};

expectAssignable<MercuriusCachePolicy>(queryPolicy);

const wrongStorageType = {
  type: "wrong type"
}

expectNotAssignable<MercuriusCacheStorageType>(wrongStorageType);

const cacheRedisStorage = {
  type: MercuriusCacheStorageType.REDIS,
  options: {
    client: {},
    invalidate: true,
    log: {log: "storage log"},
  },
};

expectAssignable<MercuriusCacheStorageRedis>(cacheRedisStorage);
expectNotAssignable<MercuriusCacheStorageMemory>(cacheRedisStorage);

const cacheMemoryStorage = {
  type: MercuriusCacheStorageType.MEMORY,
  options: {
    invalidate: true,
    size: 10000,
    log: {log: "storage log"},
  },
};

expectAssignable<MercuriusCacheStorageMemory>(cacheMemoryStorage);
expectNotAssignable<MercuriusCacheStorageRedis>(cacheMemoryStorage);


const allValidCacheOptions = {
  all: false,
  policy: queryPolicy,
  ttl: () => 1000,
  skip: () => {
    console.log("skip called!");
  },
  storage: cacheMemoryStorage,
  onDedupe: () => {
    console.log("onDedupe called!");
  },
  onHit: () => {
    console.log("onHit called!");
  },
  onMiss: () => {
    console.log("onMiss called!");
  },
  onSkip: () => {
    console.log("onSkip called!");
  },
  onError: () => {
    console.log("onError called!");
  },
  logInterval: 500,
  logReport: () => {
    console.log("log report");
  },
};
expectAssignable<MercuriusCacheOptions>(allValidCacheOptions);
app.register(mercuriusCache, allValidCacheOptions);

expectAssignable<MercuriusCacheContext | undefined>(app.graphql.cache)
