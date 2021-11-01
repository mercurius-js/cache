'use strict'

const stringify = require('safe-stable-stringify')
const StorageInterface = require('./interface')

class StorageRedis extends StorageInterface {
  constructor ({ instance, log }) {
    // TODO validate options
    super({ instance, log })
    this._store = instance
    // logger is mandatory
    this._log = log
  }

  async get (key) {
    try {
      this._log.debug({ msg: '[mercurius-cache - redis storage] get key', key })
      const value = await this._store.get(key)
      return JSON.parse(value)
    } catch (err) {
      this._log.error({ msg: '[mercurius-cache - redis storage] error on get', err, key })
    }
  }

  async set (key, value, ttl, references) {
    try {
      this._log.debug({ msg: '[mercurius-cache - redis storage] set key', key, value, ttl, references })
      await this._store.set(key, stringify(value), 'EX', ttl)

      if (!references) {
        return
      }
      for (let i = 0; i < references.length; i++) {
        const reference = references[i]
        // TODO can be done in 1 query? pipeline?
        this._log.debug({ msg: '[mercurius-cache - redis storage] set reference', key, reference })
        this._store.sadd(reference, key)
      }
    } catch (err) {
      this._log.error({ msg: '[mercurius-cache - redis storage] error on set', err, key })
    }
  }

  async invalidate (references) {
    this._log.debug({ msg: '[mercurius-cache - redis storage] invalidate', references })
    // TODO can nested loops be avoided?
    for (let i = 0; i < references.length; i++) {
      const reference = references[i]
      // TODO pipeline?
      const keys = await this._store.smembers(reference)
      this._log.debug({ msg: '[mercurius-cache - redis storage] got keys to invalidate', keys })
      if (!keys || keys.length < 1) {
        continue
      }
      for (let j = 0; j < keys.length; j++) {
        // TODO can be done in 1 query? pipeline?
        this._log.debug({ msg: '[mercurius-cache - redis storage] del key' + keys[j] })
        await this._store.del(keys[j])
      }
    }
    // TODO update references removing deleted keys?
  }

  async clear () {
    await this._store.flushall()
  }

  async refresh () {
    await this._store.flushall()
  }
}

module.exports = StorageRedis
