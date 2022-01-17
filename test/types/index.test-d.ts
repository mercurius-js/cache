import fastify from "fastify";
import mercurius from "mercurius";
import MercuriusCache, {
  MercuriusCacheOptions,
  Policy,
  PolicyFieldOptions,
  Storage,
} from "../../index";
import { expectAssignable } from "tsd";

const app = fastify();

const schema = `
    type Query {
        add(x: Int, y: Int): Int
        hello: String
    }
`;

const resolvers = {
  Query: {
    async add(_: any, { x, y }: any) {
      return x + y;
    },
  },
};

app.register(mercurius, {
  schema,
  resolvers,
});

const emptyCacheOptions = {};
expectAssignable<MercuriusCacheOptions>(emptyCacheOptions);
app.register(MercuriusCache, emptyCacheOptions);

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

expectAssignable<Policy>(queryPolicy);

const cacheStorage = {
  type: "memory",
  options: {
    client: {},
    invalidate: true,
    size: 10000,
    log: "storage log",
  },
};

expectAssignable<Storage>(cacheStorage);

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
app.register(MercuriusCache, allValidCacheOptions);
