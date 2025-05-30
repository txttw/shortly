import { Hono } from 'hono/quick'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import 'zod-openapi/extend'
import * as qs from 'qs-esm'
import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'

import {
    corsOptions,
    CustomError,
    NotFoundError,
    Permissions,
    ResourceChangedEventDescriptor,
    UnexpectedError,
} from 'shortly-shared'
import { LookupCreatedEventData } from 'shortly-shared'

import { saveLookups, SyncLinkData, SyncUserData } from './event-processing'
import {
    authorizeReadAnalytics,
    authenticateMiddleware,
} from './middleware/authorization'
import {
    linksQuerySchema,
    paginatedLinksResponseSchema,
} from './validation/links'
import { Prisma } from './generated/prisma'
import {
    lookupsParamLinkIdSchema,
    lookupsQuerySchema,
    paginatedLookupsResponseSchema,
} from './validation/lookups'
import {
    linksStatQuerySchema,
    linksStatResponeSchema,
    lookupsStatResponeSchema,
    lookupStatQuerySchema,
} from './validation/stat'

// @ts-ignore
BigInt.prototype.toJSON = function () {
    const int = Number.parseInt(this.toString())
    return int ?? this.toString()
}

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

app.use('*', cors(corsOptions))

app.get(
    '/analytics/links',
    describeRoute({
        description: 'Retrieve link resources for analytics',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(paginatedLinksResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeReadAnalytics,

    async (c) => {
        const search = new URL(c.req.url).search.slice(1)
        const query = linksQuerySchema.parse(qs.parse(search))

        const page = query?.page || 1
        const limit = query?.limit || 10

        const whereQuery: Prisma.LinkWhereInput = query?.where || {}

        // If doesnt have Permissions.Analytics_ReadAll only return Links created by the user
        if (c.var.permissions.has(Permissions.Analytics_ReadAll)) {
            whereQuery.user = query?.where?.user
        } else {
            whereQuery.user = undefined
            whereQuery.userId = c.var.authUserId
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const links = await prisma.link.findMany({
            where: { ...whereQuery, deletedAt: null },
            orderBy: query?.sort || undefined,
            omit: {
                deletedAt: true,
                v: true,
            },
            skip: (page - 1) * limit,
            take: limit + 1,
            include:
                Object.keys(query?.include || {}).length > 0
                    ? {
                          user: query?.include?.user
                              ? {
                                    select: {
                                        id: true,
                                        username: true,
                                    },
                                }
                              : undefined,
                          lookups: query?.include?.lookups
                              ? {
                                    select: {
                                        timestamp: true,
                                    },
                                    orderBy: {
                                        timestamp: 'desc',
                                    },
                                    take: 10,
                                }
                              : undefined,
                      }
                    : undefined,
        })

        const hasNextPage = links.length > limit
        if (hasNextPage) links.pop()

        return c.json({
            docs: links,
            pagination: {
                page,
                limit,
                hasNextPage,
                prev: page > 1 ? page - 1 : null,
                next: hasNextPage ? page + 1 : null,
            },
        })
    }
)

app.get(
    '/analytics/links/:linkId/lookups',
    describeRoute({
        description: 'Retrieve lookup resources for analytics',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(paginatedLookupsResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeReadAnalytics,
    zValidator('param', lookupsParamLinkIdSchema),
    async (c) => {
        const { linkId } = c.req.valid('param')
        const search = new URL(c.req.url).search.slice(1)
        const query = lookupsQuerySchema.parse(qs.parse(search))

        const page = query?.page || 1
        const limit = query?.limit || 10

        const whereQuery: Prisma.LookupWhereInput = query?.where || {}

        // If doesnt have Permissions.Analytics_ReadAll only return Links created by the user
        whereQuery.link = {
            id: linkId,
            userId: !c.var.permissions.has(Permissions.Analytics_ReadAll)
                ? c.var.authUserId
                : undefined,
            deletedAt: null,
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const lookups = await prisma.lookup.findMany({
            where: whereQuery,
            orderBy: query?.sort || undefined,
            skip: (page - 1) * limit,
            take: limit + 1,
            select: {
                id: true,
                timestamp: true,
            },
        })

        const hasNextPage = lookups.length > limit
        if (hasNextPage) lookups.pop()

        return c.json({
            docs: lookups,
            pagination: {
                page,
                limit,
                hasNextPage,
                prev: page > 1 ? page - 1 : null,
                next: hasNextPage ? page + 1 : null,
            },
        })
    }
)

app.get(
    '/analytics/links/stats',
    describeRoute({
        description: 'Retrieve statistics for links',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(linksStatResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeReadAnalytics,
    async (c) => {
        const search = new URL(c.req.url).search.slice(1)
        const query = linksStatQuerySchema.parse(qs.parse(search))

        const deletedAtQuery = {
            OR: [
                {
                    deletedAt: null,
                },
                ...(query?.statPeriod
                    ? [
                          {
                              deletedAt: {
                                  gt: query?.statPeriod?.lt,
                              },
                          },
                      ]
                    : []),
            ],
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const stats = await prisma.link.aggregate({
            where: {
                userId: !c.var.permissions.has(Permissions.Analytics_ReadAll)
                    ? c.var.authUserId
                    : undefined,

                expiresAt: query?.statPeriod,
                ...deletedAtQuery,
            },
            _count: {
                id: true,
            },
            _sum: {
                count: true,
            },
        })

        return c.json({
            stats: {
                links: stats._count.id,
                lookups: stats._sum.count,
            },
        })
    }
)

app.get(
    '/analytics/links/:linkId/stats',
    describeRoute({
        description: 'Retrieve statistics for links',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(lookupsStatResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeReadAnalytics,
    zValidator('param', lookupsParamLinkIdSchema),
    async (c) => {
        const { linkId } = c.req.valid('param')
        const search = new URL(c.req.url).search.slice(1)
        const query = lookupStatQuerySchema.parse(qs.parse(search))

        const deletedAtQuery = {
            OR: [
                {
                    deletedAt: null,
                },
                ...(query?.statPeriod
                    ? [
                          {
                              deletedAt: {
                                  gt: query?.statPeriod?.lt,
                              },
                          },
                      ]
                    : []),
            ],
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        // Find link
        const link = await prisma.link.findUnique({
            where: {
                id: linkId,
                userId: !c.var.permissions.has(Permissions.Analytics_ReadAll)
                    ? c.var.authUserId
                    : undefined,
                ...deletedAtQuery,
            },
            omit: {
                v: true,
                deletedAt: true,
            },
        })
        if (!link) {
            throw new NotFoundError()
        }

        // Raw query because prisma doesnt support date_part function
        if (query?.groupBy) {
            const statPeriod = query?.statPeriod
            let lookupWhere = ''
            let params: string[] = []
            if (statPeriod?.lt && statPeriod?.gt) {
                lookupWhere = `"timestamp" BETWEEN $2::timestamp AND $3::timestamp`
                params = [statPeriod.gt, statPeriod.lt]
            } else if (statPeriod?.lt) {
                lookupWhere = `"timestamp" <= $2::timestamp`
                params = [statPeriod.lt]
            } else if (statPeriod?.gt) {
                lookupWhere = `"timestamp" >= $2::timestamp`
                params = [statPeriod.gt]
            }

            const groupBy = query.groupBy
            const grouppedStats = await prisma.$queryRawUnsafe(
                `SELECT date_trunc('${groupBy}', "timestamp") as group, count(*) ` +
                    `FROM "Lookup" ` +
                    `WHERE "linkId" = $1 ${
                        lookupWhere ? `AND ${lookupWhere}` : ''
                    } ` +
                    `GROUP BY date_trunc('${groupBy}', "timestamp") ` +
                    `ORDER BY "group" ASC;`,
                ...[link.id, ...params]
            )

            return c.json({
                link,
                stats: { lookups: grouppedStats },
            })
        } else {
            const lookupCount = await prisma.lookup.count({
                where: {
                    linkId: link.id,
                    timestamp: query?.statPeriod,
                },
            })
            return c.json({
                link,
                stats: {
                    lookups: lookupCount,
                },
            })
        }
    }
)

app.onError((err, c) => {
    if (err instanceof ZodError) {
        c.status(422)
        return c.json({ error: err })
    }
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

app.get(
    '/analytics/schema/openapi',
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
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )
                break
            case ConsumerQueues.LINKS_ANALYTICS_QUEUE:
                await new SyncLinkData(prisma).sync(
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )

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
