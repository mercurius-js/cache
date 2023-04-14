'use strict'

const Fastify = require('fastify')
const mercuriusGateway = require('@mercuriusjs/gateway')
const mercuriusFederationPlugin = require('@mercuriusjs/federation')
const cache = require('mercurius-cache')

async function createService (port, schema, resolvers = {}) {
  const service = Fastify()

  service.register(mercuriusFederationPlugin, {
    schema,
    resolvers,
    graphiql: true
  })

  await service.listen({ port })
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

async function main () {
  await createService(4001, `
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
    }
  `, {
    Post: {
      __resolveReference: (post, args, context, info) => {
        return posts[post.pid]
      },
      category: (post, args, context, info) => {
        context.app.log.info('Post.category')
        return {
          __typename: 'Category',
          id: post.categoryId
        }
      }
    },
    Category: {
      topPosts: (category, { count }, context, info) => {
        context.app.log.info('Category.topPosts')
        return Object.values(posts)
          .filter((p) => p.categoryId === category.id)
          .slice(0, count)
      }
    },
    Query: {
      topPosts: (root, { count = 2 }, context, info) => {
        context.app.log.info('Query.topPosts')
        return Object.values(posts).slice(0, count)
      }
    }
  })

  await createService(4002, `
  type Query @extends {
    categories: [Category]
  }

  type Category @key(fields: "id") {
    id: ID! 
    name: String
  }
  `, {
    Query: {
      categories: (root, args, context, info) => {
        return Object.values(categories)
      }
    },
    Category: {
      __resolveReference: (category, args, context, info) => {
        return categories[category.id]
      }
    }
  })

  const gateway = Fastify({ logger: true })
  gateway.register(mercuriusGateway, {
    graphiql: true,
    gateway: {
      services: [
        {
          name: 'post',
          url: 'http://localhost:4001/graphql'
        },
        {
          name: 'category',
          url: 'http://localhost:4002/graphql'
        }
      ]
    }
  })

  gateway.register(cache, {
    ttl: 442,
    onHit: function (type, fieldName) {
      gateway.log.info({ msg: 'Hit from cache', type, fieldName })
    },
    onMiss: function (type, fieldName) {
      gateway.log.info({ msg: 'Miss from cache', type, fieldName })
    },
    onError (type, fieldName, error) {
      gateway.log.error(`Error on ${type} ${fieldName}`, error)
    },
    policy: {
      Post: {
        category: true
      },
      Category: {
        __resolveReference: true,
        topPosts: true
      }
    }
  })

  gateway.listen({ port: 4000 })
}

main()
