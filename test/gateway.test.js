'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const mercuriusGateway = require('@mercuriusjs/gateway')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')
const mercuriusCache = require('..')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify({ logger: { level: 'error' } })
  service.register(mercuriusFederationPlugin, {
    schema,
    resolvers
  })
  await service.listen({ port: 0 })
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

const categoryServiceSchema = `
  type Query @extends {
    categories: [Category]
  }

  type Category @key(fields: "id") {
    id: ID! 
    name: String
  }`

async function createTestGatewayServer (t, cacheOpts) {
  const categoryServiceResolvers = {
    Query: {
      categories: (root, args, context, info) => {
        t.assert.ok('Query.categories resolved')
        return Object.values(categories)
      }
    },
    Category: {
      __resolveReference: (category, args, context, info) => {
        t.assert.ok('Category.__resolveReference')
        return categories[category.id]
      }
    }
  }
  const [categoryService, categoryServicePort] = await createTestService(
    t,
    categoryServiceSchema,
    categoryServiceResolvers
  )

  const postServiceResolvers = {
    Post: {
      __resolveReference: (post, args, context, info) => {
        t.assert.ok('Post.__resolveReference')
        return posts[post.pid]
      },
      category: (post, args, context, info) => {
        t.assert.ok('Post.category')
        return {
          __typename: 'Category',
          id: post.categoryId
        }
      }
    },
    Category: {
      topPosts: (category, { count }, context, info) => {
        t.assert.ok('Category.topPosts')
        return Object.values(posts)
          .filter((p) => p.categoryId === category.id)
          .slice(0, count)
      }
    },
    Query: {
      topPosts: (root, { count = 2 }) => {
        t.assert.ok('Query.topPosts')
        return Object.values(posts).slice(0, count)
      }
    }
  }
  const [postService, postServicePort] = await createTestService(
    t,
    postServiceSchema,
    postServiceResolvers
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await categoryService.close()
    await postService.close()
  })
  gateway.register(mercuriusGateway, {
    gateway: {
      services: [
        {
          name: 'category',
          url: `http://localhost:${categoryServicePort}/graphql`
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        }
      ]
    }
  })

  if (cacheOpts) {
    gateway.register(mercuriusCache, cacheOpts)
  }

  return { gateway, postService, categoryService }
}

test('gateway - should cache it all', async (t) => {
  // The number of the tests are the number of resolvers
  // in the federeted services called for 1 request plus
  // two assertions.
  t.plan(16)

  const { gateway: app } = await createTestGatewayServer(t, {
    ttl: 4242,
    // cache it all
    policy: {
      Query: {
        categories: true,
        topPosts: true
      },
      Post: {
        category: true
      },
      Category: {
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
        id
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
            id: 'c1',
            name: 'Food'
          }
        },
        {
          pid: 'p2',
          category: {
            id: 'c2',
            name: 'Places'
          }
        }
      ]
    }
  }

  t.assert.ok('first request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepStrictEqual(res.json(), expected)
  }

  t.assert.ok('second request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query }
    })

    t.assert.deepStrictEqual(res.json(), expected)
  }
})

test('gateway - should let different fields in the query ignore the cache', async (t) => {
  // The number of the tests are the number of resolvers
  // in the federeted services called for 1 request plus
  // two assertions.
  t.plan(16)

  const { gateway: app } = await createTestGatewayServer(t, {
    ttl: 4242,
    // cache it all
    policy: {
      Query: {
        categories: true,
        topPosts: true
      },
      Post: {
        category: true
      },
      Category: {
        topPosts: true
      }
    }
  })

  const query1 = `query {
    categories {
      id
      name
      topPosts(count: 2) {
        pid
        category {
          id
        }
      }
    }
  }`

  const expected1 = {
    data: {
      categories: [
        {
          id: 'c1',
          name: 'Food',
          topPosts: [
            {
              pid: 'p1',
              category: {
                id: 'c1'
              }
            },
            {
              pid: 'p3',
              category: {
                id: 'c1'
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
                id: 'c2'
              }
            }
          ]
        }
      ]
    }
  }

  const query2 = `query {
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
  }`

  const expected2 = {
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
      ]
    }
  }

  t.assert.ok('first request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query: query1 }
    })

    t.assert.deepStrictEqual(res.json(), expected1)
  }

  t.assert.ok('second request')

  {
    const res = await app.inject({
      method: 'POST',
      url: '/graphql',
      body: { query: query2 }
    })

    t.assert.deepStrictEqual(res.json(), expected2)
  }
})
