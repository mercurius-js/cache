'use strict'

const { equal } = require('assert')

module.exports = {
  request: async function ({ app, query }) {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })
    equal(res.statusCode, 200)
    return res.json()
  }
}
