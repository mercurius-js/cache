'use strict'

const Fastify = require('fastify')
const mercuriusGateway = require('@mercuriusjs/gateway')
const mercuriusFederationPlugin = require('@mercuriusjs/federation')
const redis = require('@fastify/redis')
const fp = require('fastify-plugin')
const cache = require('..')

async function createPostService () {
  const service = Fastify()

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

  const schema = `
    type Post @key(fields: "pid") {
      pid: ID!
      category: Category
    }

    type Query @extends {
      posts: [Post]
      topPosts(count: Int): [Post]
    }

    type Category @key(fields: "id") @extends {
      id: ID! @external
      topPosts(count: Int!): [Post]
    }

    input PostInput {
      categoryId: ID!
    }

    type Mutation {
      createPost(post: PostInput!): Post
    }
  `

  const resolvers = {
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
      posts: (root, args, context, info) => {
        return Object.values(posts)
      },
      topPosts: (root, { count = 2 }, context, info) => {
        context.app.log.info('Query.topPosts')
        return Object.values(posts).slice(0, count)
      }
    },
    Mutation: {
      createPost: (root, { post }) => {
        const pid = `p${Object.values(posts).length + 1}`

        const result = {
          pid,
          ...post
        }

        posts[pid] = result
        return result
      }
    }
  }

  service.register(mercuriusFederationPlugin, {
    schema,
    resolvers,
    graphiql: true
  })

  service.register(redis)

  service.register(
    fp(async (service) => {
      service.register(
        cache,
        {
          ttl: 442,
          storage: {
            type: 'redis',
            options: { client: service.redis, invalidation: true }
          },
          onHit: function (type, fieldName) {
            service.log.info({ msg: 'Hit from cache', type, fieldName })
          },
          onMiss: function (type, fieldName) {
            service.log.info({ msg: 'Miss from cache', type, fieldName })
          },
          onError (type, fieldName, error) {
            service.log.error(`Error on ${type} ${fieldName}`, error)
          },
          policy: {
            Post: {
              category: true,
              __resolveReference: true
            }
          }
        },
        { dependencies: ['@fastify/redis'] }
      )
    })
  )

  await service.listen({ port: 4001 })
}

async function createCategoriesService () {
  const service = Fastify()

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

  const schema = `
    type Query @extends {
      categories: [Category]
    }

    type Category @key(fields: "id") {
      id: ID! 
      name: String
    }
  `

  const resolvers = {
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
  }

  service.register(mercuriusFederationPlugin, {
    schema,
    resolvers,
    graphiql: true
  })

  service.register(cache, {
    ttl: 442,
    onHit: function (type, fieldName) {
      service.log.info({ msg: 'Hit from cache', type, fieldName })
    },
    onMiss: function (type, fieldName) {
      service.log.info({ msg: 'Miss from cache', type, fieldName })
    },
    onError (type, fieldName, error) {
      service.log.error(`Error on ${type} ${fieldName}`, error)
    },
    policy: {
      Category: {
        __resolveReference: true
      }
    }
  })

  await service.listen({ port: 4002 })
}

async function main () {
  const gateway = Fastify({ logger: true })

  await createPostService()
  await createCategoriesService()

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

  gateway.register(redis)

  gateway.register(
    fp(async (gateway) => {
      gateway.register(
        cache,
        {
          ttl: 442,
          storage: {
            type: 'redis',
            options: { client: gateway.redis, invalidation: true }
          },
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
            Query: {
              posts: {
                references: (_, __, result) => {
                  if (!result) return
                  const references = result.map((post) => `post:${post.id}`)
                  references.push('posts')
                  return references
                }
              },
              topPosts: true,
              categories: true
            },
            Mutation: {
              createPost: {
                // invalidate the posts, because it may includes now the new post
                invalidate: (self, arg, ctx, info, result) => ['posts']
              }
            }
          }
        },
        { dependencies: ['@fastify/redis'] }
      )
    })
  )

  gateway.listen({ port: 4000 })
}

main()
