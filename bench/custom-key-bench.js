'use strict'

const autocannon = require('autocannon')

const queries = [
  // '{ getUser(id: "a1") { name, lastName} }',
  // '{ getUserCustom(id: "a1") { name, lastName} }',

  '{ getUsers(name: "Brian") { id, name, lastName} }',
  '{ getUsersCustom(name: "Brian") { id, name, lastName} }'
]

const query = queries[process.env.QUERY]

const instance = autocannon(
  {
    url: 'http://localhost:3000/graphql',
    connections: 100,
    title: '',
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query })
  },
  (err) => {
    if (err) {
      console.error(err)
    }
  }
)

process.once('SIGINT', () => {
  instance.stop()
})

autocannon.track(instance, { renderProgressBar: true })
