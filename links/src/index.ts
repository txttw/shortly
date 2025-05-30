import { Hono } from 'hono/quick'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import 'zod-openapi/extend'

import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'
import { LinkAlreadyExists } from './errors'
import {
    corsOptions,
    createEventData,
    CustomError,
    NotFoundError,
    PartialExceptVersion,
    Permissions,
    ResourceChangedEventDescriptor,
    UnexpectedError,
    UserChangedEventData,
} from 'shortly-shared'
import { sendEvents, appDefaults } from 'shortly-shared'
import {
    addDays,
    generateStringWithValidation,
    readShortLinkFromDB,
} from './utils'
import { handleDLQ, SyncUserData } from './event-processing'
import {
    authorizeLinkCreation,
    authenticateMiddleware,
} from './middleware/authorization'
import {
    bulkDeletedResponseSchema,
    bulkDeleteParamSchema,
    createLinkSchema,
    linkResponeSchema,
    listQuerySchema,
    paginatedLinksResponseSchema,
    paramLinkIdSchema,
    updateLinkSchema,
} from './validation/links'
import * as qs from 'qs-esm'
import { Prisma } from './generated/prisma'
import { QueuesToProduce, updateQueues } from './queues'

// APP CONFIG
// TODO We could read from DB
const appConfig = appDefaults

type DBBindings = {
    DATABASE_URL: string
}

type QueueBindings = {
    LINKS_ANALYTICS_QUEUE: Queue
    LINKS_LOOKUPS_QUEUE: Queue
    LINKS_USERS_QUEUE: Queue
}

type Bindings = DBBindings & QueueBindings

// consume from queue
enum ConsumerQueues {
    USERS_LINKS_QUEUE = 'shortly-users-links',
    LINKS_DLQ = 'shortly-links-dlq',
}

const queueBindings: { [key in QueuesToProduce]: keyof QueueBindings } = {
    [QueuesToProduce.LINKS_ANALYTICS_QUEUE]: 'LINKS_ANALYTICS_QUEUE',
    [QueuesToProduce.LINKS_LOOKUPS_QUEUE]: 'LINKS_LOOKUPS_QUEUE',
    [QueuesToProduce.LINKS_USERS_QUEUE]: 'LINKS_USERS_QUEUE',
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors(corsOptions))

app.post(
    '/links',
    describeRoute({
        description: 'Creates a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(linkResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeLinkCreation,
    zValidator('json', createLinkSchema),
    async (c) => {
        const { long, short, expiresAt } = c.req.valid('json')
        const expiresAtDate = expiresAt
            ? new Date(expiresAt)
            : addDays(new Date(), appConfig.expiresInDays)

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // Interactive transactions should run as fast as possible, checks are not included
        // With sufficiently designed short length there is very low probability that a collision happens
        // between the following check and the actual create opertion
        // We can accept it and throw an error from the create operation when happens
        let shortLink = short
        if (!shortLink) {
            shortLink = await generateStringWithValidation(
                appConfig.shortLength,
                async (str: string) => {
                    const link = await readShortLinkFromDB(prisma, str)
                    return !!link
                }
            )
        } else {
            // Validate user provided short
            const link = await readShortLinkFromDB(prisma, shortLink)
            if (link) {
                throw new LinkAlreadyExists()
            }
        }

        if (!shortLink) {
            // Short generation failed many times
            throw new UnexpectedError()
        }

        // Create the data and messages in one transaction,
        try {
            const link = await prisma.$transaction(async (tx) => {
                const link = await tx.link.create({
                    data: {
                        short: shortLink,
                        long,
                        expiresAt: expiresAtDate,
                        user: {
                            connect: {
                                id: c.var.authUserId,
                                deletedAt: null,
                            },
                        },
                    },
                })
                await tx.linkChangedEvent.createMany({
                    data: createEventData<typeof link>(updateQueues, link),
                })

                return link
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.linkChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            c.status(201)
            return c.json({
                link: { ...link, v: undefined, deletedAt: undefined },
            })
        } catch (err: any) {
            if (
                err.name === 'PrismaClientKnownRequestError' &&
                err.meta?.modelName === 'Link'
            ) {
                // P2002 - Unique constraint failed, record already exists, ack message
                if (err.code === 'P2002') {
                    throw new LinkAlreadyExists()
                }
                // P2025 - User (relationship) not found
                if (err.code === 'P2025') {
                    throw new NotFoundError()
                }
            }
            // rethrow
            throw err
        }
    }
)

app.patch(
    '/links/:id',
    describeRoute({
        description: 'Updates a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(linkResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('json', updateLinkSchema),
    zValidator('param', paramLinkIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const { long, short, expiresAt } = c.req.valid('json')

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const data = {
            short,
            long,
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        }

        // Update the data and messages in one transaction,
        try {
            const link = await prisma.$transaction(async (tx) => {
                const link = await tx.link.update({
                    where: {
                        id,
                        userId: !c.var.permissions.has(
                            Permissions.Link_WriteAll
                        )
                            ? c.var.authUserId
                            : undefined,
                        deletedAt: null,
                    },
                    data: {
                        ...data,
                        v: {
                            increment: 1,
                        },
                    },
                })
                await tx.linkChangedEvent.createMany({
                    data: createEventData<PartialExceptVersion<typeof link>>(
                        updateQueues,
                        { ...data, id: link.id, short: link.short, v: link.v }
                    ),
                })

                return link
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.linkChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            c.status(200)
            return c.json({
                link: { ...link, v: undefined, deletedAt: undefined },
            })
        } catch (err: any) {
            if (
                err.name === 'PrismaClientKnownRequestError' &&
                err.meta?.modelName === 'Link'
            ) {
                // P2002 - Unique constraint failed, record already exists, ack message
                if (err.code === 'P2025') {
                    throw new NotFoundError()
                }
            }
            // rethrow
            throw err
        }
    }
)

app.delete(
    '/links/:id',
    describeRoute({
        description: 'Delete a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(linkResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', paramLinkIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // Update the data and messages in one transaction
        try {
            const link = await prisma.$transaction(async (tx) => {
                const link = await tx.link.update({
                    where: {
                        id,
                        userId: !c.var.permissions.has(
                            Permissions.Link_DeleteAll
                        )
                            ? c.var.authUserId
                            : undefined,
                        deletedAt: null,
                    },
                    data: {
                        deletedAt: new Date(),
                        v: {
                            increment: 1,
                        },
                    },
                })
                await tx.linkChangedEvent.createMany({
                    data: createEventData<PartialExceptVersion<typeof link>>(
                        updateQueues,
                        {
                            id: link.id,
                            short: link.short,
                            deletedAt: link.deletedAt,
                            v: link.v,
                        }
                    ),
                })

                return link
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.linkChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            return c.json({ link: { ...link, v: undefined } })
        } catch (err: any) {
            if (
                err.name === 'PrismaClientKnownRequestError' &&
                err.meta?.modelName === 'Link'
            ) {
                // P2002 - Unique constraint failed, record already exists, ack message
                if (err.code === 'P2025') {
                    throw new NotFoundError()
                }
            }
            // rethrow
            throw err
        }
    }
)

app.post(
    '/links/bulk/delete',
    describeRoute({
        description: 'Bulk delete user resources',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(bulkDeletedResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('json', bulkDeleteParamSchema),
    async (c) => {
        const { ids } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // Update the data and messages in one transaction
        try {
            const links = await prisma.$transaction(async (tx) => {
                const deletedLinks = await tx.link.updateManyAndReturn({
                    where: {
                        id: {
                            in: ids,
                        },
                        user: {
                            id: !c.var.permissions.has(
                                Permissions.Link_DeleteAll
                            )
                                ? c.var.authUserId
                                : undefined,
                            deletedAt: null,
                        },
                        deletedAt: null,
                    },
                    data: {
                        deletedAt: new Date(),
                        v: {
                            increment: 1,
                        },
                    },
                })
                let eventData = []
                for (const link of deletedLinks) {
                    const data = createEventData<
                        PartialExceptVersion<typeof link>
                    >(updateQueues, {
                        id: link.id,
                        short: link.short,
                        deletedAt: link.deletedAt,
                        v: link.v,
                    })
                    eventData.push(...data)
                }
                await tx.linkChangedEvent.createMany({
                    data: eventData,
                })

                return deletedLinks
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.linkChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            return c.json({
                deleted: links.map((data) => data.id),
            })
        } catch (err: any) {
            if (
                err.name === 'PrismaClientKnownRequestError' &&
                err.meta?.modelName === 'User'
            ) {
                // P2025 - Record to update not found
                if (err.code === 'P2025') {
                    throw new NotFoundError()
                }
            }
            // rethrow
            throw err
        }
    }
)

app.get(
    '/links/:id',
    describeRoute({
        description: 'Get a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(linkResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', paramLinkIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const link = await prisma.link.findUnique({
            where: {
                id,
                userId: !c.var.permissions.has(Permissions.Link_ReadAll)
                    ? c.var.authUserId
                    : undefined,
                deletedAt: null,
            },
            omit: {
                deletedAt: true,
                v: true,
            },
        })

        if (link) {
            return c.json({ link })
        }
        throw new NotFoundError()
    }
)

app.get(
    '/links',
    describeRoute({
        description: 'List link resources associated to user',
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
    async (c) => {
        const search = new URL(c.req.url).search.slice(1)
        const query = listQuerySchema.parse(qs.parse(search))

        const page = query?.page || 1
        const limit = query?.limit || 10

        const whereQuery: Prisma.LinkWhereInput = query?.where || {}

        // If doesnt have Permissions.Link_ReadAll only return Links created by the user
        if (c.var.permissions.has(Permissions.Link_ReadAll)) {
            whereQuery.user = query?.where?.user
            whereQuery.userId = undefined
        } else {
            whereQuery.user = undefined
            whereQuery.userId = c.var.authUserId
        }

        whereQuery.deletedAt = null

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const links = await prisma.link.findMany({
            where: whereQuery,
            orderBy: query?.sort || undefined,
            omit: {
                deletedAt: true,
                v: true,
            },
            skip: (page - 1) * limit,
            take: limit + 1,
            include: query?.include?.user
                ? {
                      user: {
                          select: {
                              id: true,
                              username: true,
                          },
                      },
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
    '/links/schema/openapi',
    openAPISpecs(app, {
        documentation: {
            info: {
                title: 'Shortly - Links service',
                version: '1.0.0',
                description: 'Managing links',
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
            case ConsumerQueues.USERS_LINKS_QUEUE:
                await new SyncUserData(prisma).sync(
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )
                // Send possible cascade delete events
                try {
                    const send = async (queue: string, data: any) =>
                        await env[queueBindings[queue as QueuesToProduce]].send(
                            data
                        )
                    await sendEvents(prisma.linkChangedEvent, send)
                } catch (err) {
                    // If something fails we can retry later
                }
            case ConsumerQueues.LINKS_DLQ:
                await handleDLQ(
                    prisma,
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )
                break
        }
    },
}
