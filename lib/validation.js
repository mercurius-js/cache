'use strict'

function validateOpts (opts) {
  const { all, policy, ttl, cacheSize, onHit, onMiss, onSkip } = opts

  if (all && typeof all !== 'boolean') {
    throw new Error('all must be an boolean')
  }

  if (policy && typeof policy !== 'object' && !all) {
    throw new Error('policy must be an object')
  }

  if (all && policy) {
    throw new Error('policy and all options are exclusive')
  }

  if (ttl && typeof ttl !== 'number') {
    throw new Error('ttl must be a number')
  }

  if (cacheSize && typeof cacheSize !== 'number') {
    throw new Error('cacheSize must be a number')
  }

  if (onHit && typeof onHit !== 'function') {
    throw new Error('onHit must be a function')
  }

  if (onMiss && typeof onMiss !== 'function') {
    throw new Error('onMiss must be a function')
  }

  if (onSkip && typeof onSkip !== 'function') {
    throw new Error('onSkip must be a function')
  }
}

module.exports.validateOpts = validateOpts
