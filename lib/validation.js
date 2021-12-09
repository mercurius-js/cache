'use strict'

function validateOpts (app, opts = {}) {
  let { all, policy, ttl, skip, storage, onDedupe, onHit, onMiss, onSkip, logInterval, logReport } = opts

  if (all && typeof all !== 'boolean') {
    throw new Error('all must be a boolean')
  }

  if (all && policy) {
    throw new Error('policy and all options are exclusive')
  }

  if (ttl && (typeof ttl !== 'number' || ttl < 0)) {
    throw new Error('ttl must be a number greater than 0')
  }

  if (skip && typeof skip !== 'function') {
    throw new Error('skip must be a function')
  }

  if (onDedupe) {
    if (typeof onDedupe !== 'function') {
      throw new Error('onDedupe must be a function')
    }
  } else {
    onDedupe = noop
  }

  // TODO move report options validation to report lib
  if (logInterval && (typeof logInterval !== 'number' || logInterval < 1)) {
    throw new Error('logInterval must be a number greater than 1')
  }

  if (logReport && typeof logReport !== 'function') {
    throw new Error('logReport must be a function')
  }

  if (onHit) {
    if (typeof onHit !== 'function') {
      throw new Error('onHit must be a function')
    }
  } else {
    onHit = noop
  }

  if (onMiss) {
    if (typeof onMiss !== 'function') {
      throw new Error('onMiss must be a function')
    }
  } else {
    onMiss = noop
  }

  if (onSkip) {
    if (typeof onSkip !== 'function') {
      throw new Error('onSkip must be a function')
    }
  } else {
    onSkip = noop
  }

  if (!ttl) { ttl = 0 }
  let maxTTL = ttl
  if (policy) {
    if (typeof policy !== 'object' && !all) {
      throw new Error('policy must be an object')
    }

    for (const type of Object.keys(policy)) {
      const policyType = policy[type]
      for (const name of Object.keys(policyType)) {
        const policyField = policy[type][name]
        // TODO need to validate also nested
        if (policyField.ttl && (typeof policyField.ttl !== 'number' || policyField.ttl < 0)) {
          throw new Error(`policy '${type}.${name}' ttl must be a number greater than 0`)
        }
        if (policyField.storage) {
          // TODO doc does not set referencesTTL on polocies storage
          const validation = validateStorage(app, policyField.storage)
          if (validation.errorMessage) {
            throw new Error(`policy '${type}.${name}' storage ${validation.errorMessage}`)
          }
          policyField.storage = validation.storage
        }
        if (policyField.extendKey && typeof policyField.extendKey !== 'function') {
          throw new Error(`policy '${type}.${name}' extendKey must be a function`)
        }
        if (policyField.skip && typeof policyField.skip !== 'function') {
          throw new Error(`policy '${type}.${name}' skip must be a function`)
        }
        if (policyField.invalidate && typeof policyField.invalidate !== 'function') {
          throw new Error(`policy '${type}.${name}' invalidate must be a function`)
        }
        if (policyField.references && typeof policyField.references !== 'function') {
          throw new Error(`policy '${type}.${name}' references must be a function`)
        }
        maxTTL = Math.max(maxTTL, policyField.ttl)
      }
    }
  }

  if (storage) {
    if (ttl < 1 && maxTTL < 1) {
      throw new Error('storage is set but no ttl or policy ttl is set')
    }
    const validation = validateStorage(app, storage, maxTTL)
    if (validation.errorMessage) {
      throw new Error(`storage ${validation.errorMessage}`)
    }
    storage = validation.storage
  } else {
    storage = { type: 'memory' }
  }

  return { all, policy, ttl, skip, storage, onDedupe, onHit, onMiss, onSkip, logInterval, logReport }
}

function validateStorage (app, storage, maxTTL) {
  if (typeof storage !== 'object') {
    return { errorMessage: 'must be an object' }
  }
  if (storage.type !== 'memory' && storage.type !== 'redis') {
    return { errorMessage: 'type must be memory or redis' }
  }
  if (storage.options && typeof storage.options !== 'object') {
    return { errorMessage: 'options must be an object' }
  }

  const _storage = { ...storage }
  if (!_storage.options) {
    _storage.options = {}
  }

  if (_storage.type === 'redis' && maxTTL && _storage.options.invalidate &&
    (typeof _storage.options.invalidate === 'boolean' || (_storage.options.invalidate && !_storage.options.invalidate.referencesTTL))) {
    _storage.options = {
      ..._storage.options,
      invalidate: {
        ..._storage.options.invalidate,
        referencesTTL: maxTTL
      }
    }
  }

  if (!_storage.options.log) {
    _storage.options = {
      ..._storage.options,
      log: app.log
    }
  }
  return { storage: _storage }
}

function noop () { }

module.exports.validateOpts = validateOpts
