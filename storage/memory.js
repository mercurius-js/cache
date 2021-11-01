'use strict'

const LRUCache = require('mnemonist/lru-cache')
const StorageInterface = require('./interface')

const DEFAULT_CACHE_SIZE = 1024

class StorageMemory extends StorageInterface {
  constructor ({ size = DEFAULT_CACHE_SIZE, log }) {
    // TODO validate options
    super({ size, log })
    this._store = new LRUCache(size)
    this._references = new Map()
    // logger is mandatory
    this._log = log
  }

  async get (key) {
    const entry = this._store.get(key)
    if (entry) {
      if (entry.expires < Date.now()) {
        return entry.value
      }
      this._store.set(key, undefined)
    }
  }

  async set (key, value, ttl, references) {
    this._store.set(key, { value, expires: Date.now() + ttl })

    if (!references) {
      return
    }
    for (let i = 0; i < references.length; i++) {
      const reference = references[i]
      let keys = this._references.get(reference)
      if (keys) {
        if (keys.includes(key)) {
          continue
        }
        keys.push(key)
      }
      keys = [key]
      this._references.set(reference, keys)
    }
  }

  async invalidate (references) {
    for (let i = 0; i < references.length; i++) {
      const reference = references[i]
      const keys = this._references.get(reference)
      if (!keys) {
        continue
      }
      for (let j = 0; j < keys.length; j++) {
        this._store.set(keys[j], undefined)
      }
    }
    // TODO update references removing deleted keys?
  }

  async clear () {
    this._store.clear()
    this._references.clear()
  }

  async refresh () {
    this._store = new LRUCache(this.options.size)
    this._references = new Map()
  }
}

module.exports = StorageMemory
