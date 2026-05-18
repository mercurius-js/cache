import { FastifyPluginAsync } from 'fastify'
import { GraphQLResolveInfo } from 'graphql'

export type TtlFunction = (...args: any[]) => number

export interface KeyArgs {
  self: any
  arg: any
  info: GraphQLResolveInfo
  ctx: any
  fields: string[]
}

export interface ReferencesArgs {
  source: any
  args: any
  context: any
  info: GraphQLResolveInfo
}

export interface PolicyFieldOptions {
  ttl?: number | TtlFunction;
  stale?: number;
  storage?: MercuriusCacheStorageMemory | MercuriusCacheStorageRedis;
  key?: (args: KeyArgs) => string;
  extendKey?: (source: any, args: any, context: any, info: GraphQLResolveInfo) => string | undefined;
  skip?: (self: any, arg: any, ctx: any, info: GraphQLResolveInfo) => boolean | void | Promise<boolean | void>
  invalidate?: (self: any, arg: any, ctx: any, info: GraphQLResolveInfo, result: any) => string[] | Promise<string[]>
  references?: (args: ReferencesArgs, key: string, result: any) => string[] | null
}

export type PolicyFieldName = string
export type PolicyField = Record<PolicyFieldName, PolicyFieldOptions | object | boolean>
export type PolicyName = string
export type MercuriusCachePolicy = Record<PolicyName, PolicyField>

export interface MercuriusCacheStorageMemoryOptions {
  size: number
  log?: object
  invalidation?: boolean
}

export interface MercuriusCacheStorageRedisOptions {
  client: object
  log?: object
  invalidation?: boolean | { invalidate: boolean; referencesTTL?: number }
}

export enum MercuriusCacheStorageType {
  MEMORY = 'memory',
  REDIS = 'redis',
}
export interface MercuriusCacheStorage {
  type: 'memory' | 'redis'
}
export interface MercuriusCacheStorageMemory extends MercuriusCacheStorage {
  options?: MercuriusCacheStorageMemoryOptions
}

export interface MercuriusCacheStorageRedis extends MercuriusCacheStorage {
  options?: MercuriusCacheStorageRedisOptions
}

export interface MercuriusCacheOptions {
  all?: boolean
  policy?: MercuriusCachePolicy
  ttl?: number | TtlFunction
  stale?: number
  skip?: (self: any, arg: any, ctx: any, info: GraphQLResolveInfo) => boolean | void | Promise<boolean | void>
  storage?: MercuriusCacheStorageMemory | MercuriusCacheStorageRedis
  onDedupe?: (type: string, fieldName: string) => void
  onHit?: (type: string, fieldName: string) => void
  onMiss?: (type: string, fieldName: string) => void
  onSkip?: (type: string, fieldName: string) => void
  onError?: (type: string, fieldName: string, error: Error) => void
  logInterval?: number
  logReport?: (report: ReportData) => void
}
export interface QueryFieldData {
  dedupes: number
  hits: number
  misses: number
  skips: number
}

export type QueryFieldName = string
export type ReportData = Record<QueryFieldName, QueryFieldData>

export declare class Report {
  constructor (
    app: object,
    all?: boolean,
    policy?: any,
    logInterval?: number,
    logReport?: (report: ReportData) => void
  )

  log: object
  logReport: (report: ReportData) => void
  logInterval: number
  logTimer: () => void
  data: ReportData

  init (options: MercuriusCacheOptions): void
  clear (): void
  defaultLog (): void
  logReportAndClear (): void
  refresh (): void
  close (): void
  wrap (
    name: string,
    onDedupe: () => void,
    onHit: () => void,
    onMiss: () => void,
    onSkip: () => void
  ): void
}

/** Mercurius Cache is a plugin that adds an in-process caching layer to Mercurius. */
declare const mercuriusCache: FastifyPluginAsync<MercuriusCacheOptions>

export interface MercuriusCacheContext {
  refresh(): void
  clear(): void
  invalidate(references: string | string[], storage?: string): void
}

declare module 'mercurius' {
  interface MercuriusPlugin {
    cache?: MercuriusCacheContext
  }
}

export default mercuriusCache
