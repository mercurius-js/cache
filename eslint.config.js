'use strict'

const neostandard = require('neostandard')

module.exports = neostandard({
  ts: true,
  noJsx: true,
  ignores: [
    '.nyc_output/**',
    'coverage/**'
  ]
})
