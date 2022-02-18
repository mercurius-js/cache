'use strict'

const { equal } = require('assert')

module.exports = {
  request: async function ({ app, query, variables }) {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query, variables }
    })
    equal(res.statusCode, 200)
    return res.json()
  }
}
