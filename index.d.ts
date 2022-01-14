export interface CacheOptions {
    app: any
    all?: boolean
    policy?: any
    ttl?: number
    skip?: Function
    storage?: Storage
    onDedupe?: Function
    onHit?: Function
    onMiss?: Function
    onSkip?: Function
    onError?: Function
    logInterval?: number
    logReport?: Function
}

export interface PolicyField {
    ttl?: number
    storage?: Storage
    extendKey?: Function
    skip?: Function
    invalidate?: Function
    references?: Function
}

export enum StorageType {
    MEMORY = 'memory',
    REDIS = 'redis'
}

export interface StorageOptions {
    invalidate: boolean | { invalidate: boolean, referencesTTL: number }
    size?: number,
    log?: string
}

export interface Storage {
    type: StorageType
    client: any
    options?: StorageOptions
}

export interface QueryFieldData {
    dedupes: number
    hits: number
    misses: number
    skips: number
}

export type QueryFieldName = string;
export type ReportData = Record<QueryFieldName, QueryFieldData>;

declare class Report {
    constructor(options: Pick<CacheOptions, 'app' | 'all' | 'policy' | 'logInterval' | 'logReport'>)

    log: any
    logReport: Function
    logInterval: number
    logTimer: any
    data: ReportData
    
    init(options: CacheOptions): void
    clear(): void
    defaultLog(): void
    logReportAndClear(): void
    refresh(): void
    close(): void
    wrap(options: Pick<CacheOptions, 'onDedupe' | 'onHit' | 'onMiss' | 'onSkip'>): void
}