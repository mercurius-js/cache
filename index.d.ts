import { FastifyPluginAsync } from "fastify";
import { MercuriusPlugin } from "mercurius";

export type TtlFunction = (...args: any[]) => number;
export interface PolicyFieldOptions {
  ttl?: number | TtlFunction;
  stale?: number;
  storage?: MercuriusCacheStorageMemory | MercuriusCacheStorageRedis;
  extendKey?: Function;
  skip?: Function;
  invalidate?: Function;
  references?: Function;
}

export type PolicyFieldName = string;
export type PolicyField = Record<PolicyFieldName, PolicyFieldOptions | object | boolean>;
export type PolicyName = string;
export type MercuriusCachePolicy = Record<PolicyName, PolicyField>;

export interface MercuriusCacheStorageMemoryOptions {
  size: number;
  log?: object;
  invalidation?: boolean;
}

export interface MercuriusCacheStorageRedisOptions {
  client: object;
  log?: object;
  invalidation?: boolean | { invalidate: boolean; referencesTTL?: number };
}

export enum MercuriusCacheStorageType {
  MEMORY = "memory",
  REDIS = "redis",
}
export interface MercuriusCacheStorage {
  type: "memory" | "redis";
}
export interface MercuriusCacheStorageMemory extends MercuriusCacheStorage {
  options?: MercuriusCacheStorageMemoryOptions;
}

export interface MercuriusCacheStorageRedis extends MercuriusCacheStorage {
  options?: MercuriusCacheStorageRedisOptions;
}

export interface MercuriusCacheOptions {
  all?: boolean;
  policy?: MercuriusCachePolicy;
  ttl?: number | TtlFunction;
  stale?: number;
  skip?: Function;
  storage?: MercuriusCacheStorageMemory | MercuriusCacheStorageRedis;
  onDedupe?: Function;
  onHit?: Function;
  onMiss?: Function;
  onSkip?: Function;
  onError?: Function;
  logInterval?: number;
  logReport?: Function;
}
export interface QueryFieldData {
  dedupes: number;
  hits: number;
  misses: number;
  skips: number;
}

export type QueryFieldName = string;
export type ReportData = Record<QueryFieldName, QueryFieldData>;

export declare class Report {
  constructor(
    app: object,
    all?: boolean,
    policy?: any,
    logInterval?: number,
    logReport?: Function
  );

  log: object;
  logReport: Function;
  logInterval: number;
  logTimer: Function;
  data: ReportData;

  init(options: MercuriusCacheOptions): void;
  clear(): void;
  defaultLog(): void;
  logReportAndClear(): void;
  refresh(): void;
  close(): void;
  wrap(
    name: string,
    onDedupe: Function,
    onHit: Function,
    onMiss: Function,
    onSkip: Function
  ): void;
}

/** Mercurius Cache is a plugin that adds an in-process caching layer to Mercurius. */
declare const mercuriusCache: FastifyPluginAsync<MercuriusCacheOptions>;

export interface MercuriusCacheContext {
  refresh(): void;
  clear(): void;
  invalidate(references: string | string[], storage?: string): void
}

declare module "mercurius" {
  interface MercuriusPlugin {
    cache?: MercuriusCacheContext;
  }
}

export default mercuriusCache;
