import { Hono } from 'hono/quick'
import { z } from 'zod'
import 'zod-openapi/extend'

import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'

import {
    appDefaults,
    CustomError,
    NotAllowedError,
    NotFoundError,
    UnexpectedError,
} from 'shortly-shared'
import {
    LinkChangedEventData,
    LookupCreatedEventData,
    UserChangedEventData,
} from 'shortly-shared'

import { saveLookups, SyncLinkData, SyncUserData } from './event-processing'
import {
    authorizeReadAnalytics,
    getAuthorizationData,
} from './middleware/authorization'

// APP CONFIG
// TODO We could read from DB
const appConfig = appDefaults

type Bindings = {
    DATABASE_URL: string
    SHORTLY_ANALYTICS_LIVE: Queue
}

// consumers
enum ConsumerQueues {
    USERS_ANALYTICS_QUEUE = 'shortly-users-analytics',
    LINKS_ANALYTICS_QUEUE = 'shortly-links-analytics',
    LOOKUPS_ANALYTICS_QUEUE = 'shortly-lookups-analytics',
}

const app = new Hono<{ Bindings: Bindings }>()

const reqSchema = z.object({
    short: z.string().length(appConfig.shortLength),
})

const querySchema = z.object({
    limit: z.optional(z.string().regex(/^\d{1,3}$/)).default('5'),
})

const AnalyticsSchema = z.object({
    link: z.object({
        id: z.string(),
        short: z.string().length(appConfig.shortLength),
        count: z.number(),
    }),
    recent: z.array(z.string().datetime()),
})

app.get(
    '/analytics/:short',
    describeRoute({
        description: 'Provides analytics data for a short link',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(AnalyticsSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    authorizeReadAnalytics,
    zValidator('param', reqSchema),
    zValidator('query', querySchema),
    async (c) => {
        const { short } = c.req.valid('param')
        const { limit } = c.req.valid('query')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const link = await prisma.link.findUnique({
            where: {
                short,
                deletedAt: null,
                user: {
                    id: c.var.authUserId,
                    deletedAt: null,
                },
            },
            select: {
                v: false,
                deletedAt: false,
                expiresAt: true,
                id: true,
                short: true,
                long: true,
                count: true,
                lookups: {
                    select: {
                        timestamp: true,
                    },
                    orderBy: {
                        timestamp: 'desc',
                    },
                    take: Math.min(Math.max(Number(limit), 0), 100),
                },
            },
        })

        if (!link) {
            throw new NotFoundError()
        }

        return c.json({ link })
    }
)

app.onError((err, c) => {
    console.log(err)
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

app.get(
    '/analytics/doc/openapi',
    openAPISpecs(app, {
        documentation: {
            info: {
                title: 'Link shortener - Analytics service',
                version: '1.0.0',
                description: 'Providing analytics data',
            },
            /*servers: [
        {
          url: "http://localhost:3000",
          description: "Local server",
        },
      ],*/
        },
    })
)

export default {
    fetch: app.fetch,
    async queue(batch: MessageBatch, env: Bindings) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        switch (batch.queue) {
            case ConsumerQueues.USERS_ANALYTICS_QUEUE:
                await new SyncUserData(prisma).sync(
                    batch as MessageBatch<UserChangedEventData>
                )
                break
            case ConsumerQueues.LINKS_ANALYTICS_QUEUE:
                try {
                    await new SyncLinkData(prisma).sync(
                        batch as MessageBatch<LinkChangedEventData>
                    )
                } catch (err) {
                    console.log(err)
                }
                break
            case ConsumerQueues.LOOKUPS_ANALYTICS_QUEUE:
                const linksUpdated = await saveLookups(
                    prisma,
                    batch as MessageBatch<LookupCreatedEventData>
                )
                const messages: MessageSendRequest[] = linksUpdated
                    .filter((data) => !data.link.deletedAt)
                    .map((data) => ({
                        body: {
                            ...data.link,
                            v: undefined,
                            deletedAt: undefined,
                            timestamps: data.timestamps,
                        },
                    }))
                await env.SHORTLY_ANALYTICS_LIVE.sendBatch(messages)
                break
        }
    },
}
