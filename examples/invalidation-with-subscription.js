'use strict'

const fastify = require('fastify')
const mercurius = require('mercurius')
const redis = require('@fastify/redis')
const fp = require('fastify-plugin')
const cache = require('mercurius-cache')

async function main () {
  const app = fastify({ logger: true })

  const schema = `
  type Notification {
    id: ID!
    message: String
  }

  type Query {
    notifications: [Notification]
  }

  type Mutation {
    addNotification(message: String): Notification
  }

  type Subscription {
    notificationAdded: Notification
  }
`

  const notifications = [
    {
      id: 1,
      message: 'Notification message'
    }
  ]

  const resolvers = {
    Query: {
      notifications: (_, __, { app }) => {
        app.log.info('Requesting notifications')
        return notifications
      }
    },
    Mutation: {
      addNotification: async (_, { message }, { pubsub }) => {
        app.log.info('Adding a notification')

        const notification = {
          id: notifications.length + 1,
          message
        }

        notifications.push(notification)
        await pubsub.publish({
          topic: 'NOTIFICATION_ADDED',
          payload: {
            notificationAdded: notification
          }
        })

        return notification
      }
    },
    Subscription: {
      notificationAdded: {
        subscribe: async (root, args, { pubsub }) =>
          await pubsub.subscribe('NOTIFICATION_ADDED')
      }
    }
  }

  app.register(mercurius, {
    schema,
    resolvers,
    graphiql: true,
    subscription: true
  })

  app.register(redis)

  app.register(
    fp(async (app) => {
      app.register(
        cache,
        {
          ttl: 10,
          // default storage is redis
          storage: {
            type: 'redis',
            options: { client: app.redis, invalidation: true }
          },
          onHit: function (type, fieldName) {
            app.log.info({ msg: 'Hit from cache', type, fieldName })
          },
          onMiss: function (type, fieldName) {
            app.log.info({ msg: 'Miss from cache', type, fieldName })
          },
          policy: {
            Query: {
              notifications: {
                references: (_, __, result) => {
                  if (!result) { return }
                  const references = result.map(notification => (`notification:${notification.id}`))
                  references.push('notifications')
                  return references
                }
              }
            },
            Mutation: {
              addNotification: {
                // invalidate the notifications, because it may includes now the new notification
                invalidate: (self, arg, ctx, info, result) => ['notifications']
              }
            }
          }
        },
        { dependencies: ['fastify-redis'] }
      )
    })
  )

  await app.listen({ port: 3000 })
}

main()
