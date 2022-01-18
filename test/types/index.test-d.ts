import fastify from "fastify";
import {
  MercuriusCacheOptions,
  MercuriusCachePolicy,
  PolicyFieldOptions,
  MercuriusCacheStorage,
  MercuriusCacheContext,
} from "../../index";
import { expectAssignable } from "tsd";
import mercuriusCache from "../../index";

const app = fastify();

const emptyCacheOptions = {};
expectAssignable<MercuriusCacheOptions>(emptyCacheOptions);
app.register(mercuriusCache, emptyCacheOptions);

expectAssignable<MercuriusCacheContext | undefined>(app.graphql.cache)

const queryFieldPolicy = {
  ttl: 1,
  storage: { type: "memory", options: { size: 1 } },
};

expectAssignable<PolicyFieldOptions>(queryFieldPolicy);

const queryPolicy = {
  Query: {
    add: queryFieldPolicy,
  },
};

expectAssignable<MercuriusCachePolicy>(queryPolicy);

const cacheStorage = {
  type: "memory",
  options: {
    client: {},
    invalidate: true,
    size: 10000,
    log: "storage log",
  },
};

expectAssignable<MercuriusCacheStorage>(cacheStorage);

const allValidCacheOptions = {
  all: false,
  policy: queryPolicy,
  ttl: 1000,
  skip: () => {
    console.log("skip called!");
  },
  storage: cacheStorage,
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
