'use strict'

class StorageInterface {
  constructor (options) {
    this.options = options
  }

  async get (key) { throw new Error('storage get method not implemented') }
  async set (key, value, ttl, references) { throw new Error('storage set method not implemented') }
  async invalidate (references) { throw new Error('storage invalidate method not implemented') }
  async clear () { throw new Error('storage clear method not implemented') }
  async refresh () { throw new Error('storage refresh method not implemented') }
}

module.exports = StorageInterface
