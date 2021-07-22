'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const mercurius = require('mercurius')
const mercuriusCache = require('..')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify({ logger: { level: 'error' } })
  service.register(mercurius, {
    schema,
    resolvers,
    federationMetadata: true
  })
  await service.listen(0)
  return [service, service.server.address().port]
}

const categories = {
  c1: {
    id: 'c1',
    name: 'Food'
  },
  c2: {
    id: 'c2',
    name: 'Places'
  }
}

const posts = {
  p1: {
    pid: 'p1',
    title: 'Post 1',
    content: 'Content 1',
    categoryId: 'c1'
  },
  p2: {
    pid: 'p2',
    title: 'Post 2',
    content: 'Content 2',
    categoryId: 'c2'
  },
  p3: {
    pid: 'p3',
    title: 'Post 3',
    content: 'Content 3',
    categoryId: 'c1'
  },
  p4: {
    pid: 'p4',
    title: 'Post 4',
    content: 'Content 4',
    categoryId: 'c1'
  }
}

async function createTestGatewayServer (t, cacheOpts) {
  // User service
  const categoryServiceSchema = `
  type Query @extends {
    categories: [Category]
  }

  type Category @key(fields: "id") {
    id: ID! 
    name: String
  }`
  const categoryServiceResolvers = {
    Query: {
      categories: (root, args, context, info) => {
        t.pass('Query.categories resolved')
        return Object.values(categories)
      }
    },
    Category: {
      __resolveReference: (category, args, context, info) => {
        t.pass('Category.__resolveReference')
        return categories[category.id]
      }
    }
  }
  const [categoryService, categoryServicePort] = await createTestService(t, categoryServiceSchema, categoryServiceResolvers)

  // Post service
  const postServiceSchema = `
  type Post @key(fields: "pid") {
    pid: ID!
    category: Category
  }

  type Query @extends {
    topPosts(count: Int): [Post]
  }

  type Category @key(fields: "id") @extends {
    id: ID! @external
    topPosts(count: Int!): [Post]
  }`
  const postServiceResolvers = {
    Post: {
      __resolveReference: (post, args, context, info) => {
        t.pass('Post.__resolveReference')
        return posts[post.pid]
      },
      category: (post, args, context, info) => {
        t.pass('Post.category')
        return {
          __typename: 'Category',
          id: post.categoryId
        }
      }
    },
    Category: {
      topPosts: (category, { count }, context, info) => {
        t.pass('Category.topPosts')
        return Object.values(posts).filter(p => p.categoryId === category.id).slice(0, count)
      }
    },
    Query: {
      topPosts: (root, { count = 2 }) => {
        t.pass('Query.topPosts')
        return Object.values(posts).slice(0, count)
      }
    }
  }
  const [postService, postServicePort] = await createTestService(t, postServiceSchema, postServiceResolvers)

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await categoryService.close()
    await postService.close()
  })
  gateway.register(mercurius, {
    gateway: {
      services: [{
        name: 'category',
        url: `http://localhost:${categoryServicePort}/graphql`
      }, {
        name: 'post',
        url: `http://localhost:${postServicePort}/graphql`
      }]
    }
  })

  if (cacheOpts) {
    gateway.register(mercuriusCache, cacheOpts)
  }

  return gateway
}

test('gateway - should cache it all', async (t) => {
  // The number of the tests are the number of resolvers
  // in the federeted services called for 1 request plus
  // two assertions.
  t.plan(14)

  const app = await createTestGatewayServer(t, {
    // cache it all
    policy: {
      Query: {
        categories: true,
        topPosts: true
      },
      Post: {
        __resolveReference: true,
        category: true
      },
      Category: {
        __resolveReference: true,
        topPosts: true
      }
    }
  })

  const query = `query {
    categories {
      id
      name
      topPosts(count: 2) {
        pid
        category {
          id
          name
        }
      }
    }
    topPosts(count: 2) {
      pid,
      category {
        name
      }
    }
  }`

  const expected = {
    data: {
      categories: [
        {
          id: 'c1',
          name: 'Food',
          topPosts: [
            {
              pid: 'p1',
              category: {
                id: 'c1',
                name: 'Food'
              }
            },
            {
              pid: 'p3',
              category: {
                id: 'c1',
                name: 'Food'
              }
            }
          ]
        },
        {
          id: 'c2',
          name: 'Places',
          topPosts: [
            {
              pid: 'p2',
              category: {
                id: 'c2',
                name: 'Places'
              }
            }
          ]
        }
      ],
      topPosts: [
        {
          pid: 'p1',
          category: {
            name: 'Food'
          }
        },
        {
          pid: 'p2',
          category: {
            name: 'Places'
          }
        }
      ]
    }
  }

  t.comment('first request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.same(res.json(), expected)
  }

  t.comment('second request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.same(res.json(), expected)
  }
})
/*
test('gateway - should protect the schema if everything is not okay', async (t) => {
  t.plan(1)
  const app = await createTestGatewayServer(t)

  const query = `query {
  me {
    id
    name
    nickname: name
    topPosts(count: 2) {
      pid
      author {
        id
      }
    }
  }
  topPosts(count: 2) {
    pid
  }
}`

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': 'user' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: null,
        nickname: null,
        topPosts: [
          {
            pid: 'p1',
            author: null
          },
          {
            pid: 'p3',
            author: null
          }
        ]
      },
      topPosts: null
    },
    errors: [
      { message: 'Failed auth policy check on topPosts', locations: [{ line: 13, column: 3 }], path: ['topPosts'] },
      { message: 'Failed auth policy check on name', locations: [{ line: 4, column: 5 }], path: ['me', 'name'] },
      { message: 'Failed auth policy check on name', locations: [{ line: 5, column: 5 }], path: ['me', 'nickname'] },
      { message: 'Failed auth policy check on author', locations: [{ line: 8, column: 7 }], path: ['me', 'topPosts', 0, 'author'] },
      { message: 'Failed auth policy check on author', locations: [{ line: 8, column: 7 }], path: ['me', 'topPosts', 1, 'author'] }
    ]
  })
})

test('gateway - should handle custom errors', async (t) => {
  t.plan(1)
  const app = await createTestGatewayServer(t, {
    authContext (context) {
      return {
        identity: context.reply.request.headers['x-user']
      }
    },
    async applyPolicy (authDirectiveAST, parent, args, context, info) {
      if (context.auth.identity !== 'admin') {
        return new Error(`custom auth error on ${info.fieldName}`)
      }
      return true
    },
    authDirective: 'auth'
  })

  const query = `query {
  me {
    id
    name
    nickname: name
    topPosts(count: 2) {
      pid
      author {
        id
      }
    }
  }
  topPosts(count: 2) {
    pid
  }
}`

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': 'user' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: null,
        nickname: null,
        topPosts: [
          {
            pid: 'p1',
            author: null
          },
          {
            pid: 'p3',
            author: null
          }
        ]
      },
      topPosts: null
    },
    errors: [
      { message: 'custom auth error on topPosts', locations: [{ line: 13, column: 3 }], path: ['topPosts'] },
      { message: 'custom auth error on name', locations: [{ line: 4, column: 5 }], path: ['me', 'name'] },
      { message: 'custom auth error on name', locations: [{ line: 5, column: 5 }], path: ['me', 'nickname'] },
      { message: 'custom auth error on author', locations: [{ line: 8, column: 7 }], path: ['me', 'topPosts', 0, 'author'] },
      { message: 'custom auth error on author', locations: [{ line: 8, column: 7 }], path: ['me', 'topPosts', 1, 'author'] }
    ]
  })
})

test('gateway - should handle when auth context is not defined', async (t) => {
  t.plan(1)
  const app = await createTestGatewayServer(t, {
    async applyPolicy (authDirectiveAST, parent, args, context, info) {
      if (context.other.identity !== 'admin') {
        return new Error(`custom auth error on ${info.fieldName}`)
      }
      return true
    },
    authDirective: 'auth'
  })

  app.graphql.addHook('preGatewayExecution', async (schema, document, context, service) => {
    Object.assign(context, {
      other: {
        identity: context.reply.request.headers['x-user']
      }
    })
  })

  const query = `query {
  me {
    id
    name
    nickname: name
    topPosts(count: 2) {
      pid
      author {
        id
      }
    }
  }
  topPosts(count: 2) {
    pid
  }
}`

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': 'admin' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        nickname: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})
*/
