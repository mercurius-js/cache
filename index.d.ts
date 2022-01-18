import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { MercuriusPlugin } from "mercurius";
export interface PolicyFieldOptions {
  ttl?: number;
  storage?: MercuriusCacheStorage;
  extendKey?: Function;
  skip?: Function;
  invalidate?: Function;
  references?: Function;
}

export type PolicyFieldName = string;
export type PolicyField = Record<PolicyFieldName, PolicyFieldOptions | object>;
export type PolicyName = string;
export type MercuriusCachePolicy = Record<PolicyName, PolicyField>;

export interface MercuriusCacheStorageOptions {
  client?: object;
  invalidate?: boolean | { invalidate: boolean; referencesTTL: number };
  size?: number;
  log?: string;
}

export interface MercuriusCacheStorage {
  type: string;
  options?: MercuriusCacheStorageOptions;
}

export interface MercuriusCacheOptions {
  all?: boolean;
  policy?: MercuriusCachePolicy;
  ttl?: number;
  skip?: Function;
  storage?: MercuriusCacheStorage;
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
declare const mercuriusCache: FastifyPluginAsync<MercuriusCacheOptions>

export interface MercuriusCacheContext {
    refresh(): void;
    clear(): void;
}

declare module 'mercurius' {
    interface MercuriusPlugin {
      cache?: MercuriusCacheContext
    }
  }

export default mercuriusCache;
