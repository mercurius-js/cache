'use strict'

const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

async function main () {
  const app = Fastify({ logger: false })

  const posts = {
    p1: {
      pid: 'p1',
      title: 'Post 1',
      content: 'Content 1',
      authorId: 'u1'
    },
    p2: {
      pid: 'p2',
      title: 'Post 2',
      content: 'Content 2',
      authorId: 'u2'
    },
    p3: {
      pid: 'p3',
      title: 'Post 3',
      content: 'Content 3',
      authorId: 'u1'
    },
    p4: {
      pid: 'p4',
      title: 'Post 4',
      content: 'Content 4',
      authorId: 'u1'
    }
  }

  const schema = `
    type Post @key(fields: "pid") {
      pid: ID!
      title: String
      content: String
      author: User
    }

    extend type Query {
      topPosts(count: Int): [Post]
      getPost(pid: ID!): Post
    }

    extend type Mutation {
      updatePostTitle(pid: ID!, title: String!): Post
    }

    type User @key(fields: "id") @extends {
      id: ID! @external
      topPosts(count: Int!): [Post]
    }
  `

  const resolvers = {
    Post: {
      __resolveReference: (post) => posts[post.pid],
      author: (post) => ({
        __typename: 'User',
        id: post.authorId
      })
    },
    User: {
      topPosts: (user, { count }) => {
        return Object.values(posts).filter(p => p.authorId === user.id).slice(0, count)
      }
    },
    Query: {
      topPosts: (_, { count = 2 }) => Object.values(posts).slice(0, count),
      getPost: (_, { pid }) => posts[pid]
    },
    Mutation: {
      updatePostTitle: (_, args) => {
        if (!posts[args.pid]) {
          throw new Error('Post not found')
        }
        posts[args.pid].title = args.title
        return posts[args.pid]
      }
    }
  }

  await app.register(mercuriusFederationPlugin, {
    schema,
    resolvers,
    jit: 1
  })

  await app.listen({ port: 3002 })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
