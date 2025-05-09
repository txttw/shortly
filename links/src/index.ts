import { Hono } from 'hono/quick'
import { RefinementCtx, z } from 'zod'
import 'zod-openapi/extend'

import prismaClients, { PrismaClientAccelerated } from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'
import { LinkAlreadyExists } from './errors'
import {
    createEventData,
    CustomError,
    NotAllowedError,
    NotFoundError,
    PartialExceptVersion,
    Scopes,
    UnexpectedError,
    UserChangedEventData,
} from 'shortly-shared'
import { LinkChangedEventData } from 'shortly-shared'
import { sendEvents, appDefaults } from 'shortly-shared'
import {
    addDays,
    generateStringWithValidation,
    readShortLinkFromDB,
} from './utils'
import { SyncUserData } from './event-processing'
import {
    authorizeLinkCreation,
    getAuthorizationData,
} from './middleware/authorization'

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

enum Queues {
    LINKS_ANALYTICS_QUEUE = 'shortly-links-analytics',
    LINKS_LOOKUPS_QUEUE = 'shortly-links-lookups',
    LINKS_USERS_QUEUE = 'shortly-links-users',
}

const queueBindings: { [key in Queues]: keyof QueueBindings } = {
    [Queues.LINKS_ANALYTICS_QUEUE]: 'LINKS_ANALYTICS_QUEUE',
    [Queues.LINKS_LOOKUPS_QUEUE]: 'LINKS_LOOKUPS_QUEUE',
    [Queues.LINKS_USERS_QUEUE]: 'LINKS_USERS_QUEUE',
}

const app = new Hono<{ Bindings: Bindings }>()

const expires_at_validator = z
    .string()
    .datetime()
    .superRefine((val: string, ctx: RefinementCtx) => {
        if (new Date(val).getTime() <= new Date().getTime()) {
            ctx.addIssue({
                code: z.ZodIssueCode.invalid_date,
                message: 'Date must be in the future',
            })
        }
    })

const createBodySchema = z.object({
    long: z.string().url(),
    short: z.optional(z.string().length(appConfig.shortLength)),
    expiresAt: z.optional(expires_at_validator),
})

const LinkSchema = z.object({
    username: z.string().openapi({ example: 'Steven' }),
    id: z.string(),
    short: z.string().length(6),
    long: z.string().url(),
    userId: z.string().uuid(),
    createdAt: z.date(),
    expiresAt: z.date(),
})

app.post(
    '/links',
    describeRoute({
        description: 'Creates a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(LinkSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    authorizeLinkCreation,
    zValidator('json', createBodySchema),
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
            const { link, events } = await prisma.$transaction(async (tx) => {
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
                const events = await tx.linkChangedEvent.createManyAndReturn({
                    data: createEventData<typeof link>(
                        [
                            Queues.LINKS_ANALYTICS_QUEUE,
                            Queues.LINKS_LOOKUPS_QUEUE,
                            Queues.LINKS_USERS_QUEUE,
                        ],
                        link
                    ),
                })

                return { link, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.linkChangedEvent,
                    events,
                    send
                )
                if (sentCount < events.length)
                    throw Error('Some of the events are not sent')
            } catch (err) {
                // TODO Implement the workflow
                // Trigger the workflow
                // Ok to continue we will retry later
            }

            c.status(201)
            return c.json({ ...link, v: undefined, deletedAt: undefined })
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

const updateBodySchema = z
    .object({
        long: z.optional(z.string().url()),
        short: z.optional(z.string()),
        expiresAt: z.optional(expires_at_validator),
    })
    .refine(
        ({ long, expiresAt }) => long !== undefined || expiresAt !== undefined,
        { message: 'One of the fields must be defined [long, expiresAt]' }
    )
    .refine(({ short }) => short === undefined, {
        message: "'short': short link can not be changed",
    })
const updateParamSchema = z.object({
    id: z.string().uuid(),
})

app.patch(
    '/links/:id',
    describeRoute({
        description: 'Updates a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(LinkSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    zValidator('json', updateBodySchema),
    zValidator('param', updateParamSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const { long, short, expiresAt } = c.req.valid('json')

        if (
            id !== c.var.authUserId &&
            !c.var.scopes.has(Scopes.WriteAllLinks)
        ) {
            throw new NotAllowedError()
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const data = {
            short,
            long,
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        }

        // Update the data and messages in one transaction,
        try {
            const { link, events } = await prisma.$transaction(async (tx) => {
                const link = await tx.link.update({
                    where: {
                        id,
                        user: {
                            id: c.var.authUserId,
                            deletedAt: null,
                        },
                        deletedAt: null,
                    },
                    data: {
                        ...data,
                        v: {
                            increment: 1,
                        },
                    },
                })
                const events = await tx.linkChangedEvent.createManyAndReturn({
                    data: createEventData<PartialExceptVersion<typeof link>>(
                        [
                            Queues.LINKS_ANALYTICS_QUEUE,
                            Queues.LINKS_LOOKUPS_QUEUE,
                            Queues.LINKS_USERS_QUEUE,
                        ],
                        { ...data, id: link.id, short: link.short, v: link.v }
                    ),
                })

                return { link, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.linkChangedEvent,
                    events,
                    send
                )
                if (sentCount < events.length)
                    throw Error('Some of the events are not sent')
            } catch (err) {
                // TODO Implement the workflow
                // Trigger the workflow
                // Ok to continue we will retry later
            }

            c.status(200)
            return c.json({ ...link, v: undefined, deletedAt: undefined })
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
                        schema: resolver(LinkSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    zValidator('param', updateParamSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        if (
            id !== c.var.authUserId &&
            !c.var.scopes.has(Scopes.WriteAllLinks)
        ) {
            throw new NotAllowedError()
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // Update the data and messages in one transaction
        try {
            const { link, events } = await prisma.$transaction(async (tx) => {
                const link = await tx.link.update({
                    where: {
                        id,
                        user: {
                            id: c.var.authUserId,
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
                const events = await tx.linkChangedEvent.createManyAndReturn({
                    data: createEventData<PartialExceptVersion<typeof link>>(
                        [
                            Queues.LINKS_ANALYTICS_QUEUE,
                            Queues.LINKS_LOOKUPS_QUEUE,
                            Queues.LINKS_USERS_QUEUE,
                        ],
                        {
                            id: link.id,
                            short: link.short,
                            deletedAt: link.deletedAt,
                            v: link.v,
                        }
                    ),
                })

                return { link, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.linkChangedEvent,
                    events,
                    send
                )
                if (sentCount < events.length)
                    throw Error('Some of the events are not sent')
            } catch (err) {
                // TODO Implement the workflow
                // Trigger the workflow
                // Ok to continue we will retry later
            }

            c.status(200)
            return c.json({ ...link, v: undefined })
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

app.get(
    '/links/:id',
    describeRoute({
        description: 'Get a link resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(LinkSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    zValidator('param', updateParamSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        if (
            id !== c.var.authUserId &&
            !c.var.scopes.has(Scopes.WriteAllLinks)
        ) {
            throw new NotAllowedError()
        }
        console.log(c.var.authUserId, id)
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const link = await prisma.link.findUnique({
            where: {
                id,
                user: {
                    id: c.var.authUserId,
                    deletedAt: null,
                },
                deletedAt: null,
            },
        })
        console.log(link)
        if (link) {
            c.status(200)
            return c.json({
                link: { ...link, deletedAt: undefined, v: undefined },
            })
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
                        schema: resolver(LinkSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    async (c) => {
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const links = await prisma.link.findMany({
            where: {
                user: {
                    id: c.var.authUserId,
                    deletedAt: null,
                },
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: 100,
        })
        c.status(200)
        return c.json({ links })
    }
)

app.onError((err, c) => {
    console.log(err)
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

app.get(
    '/links/doc/openapi',
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
    async queue(batch: MessageBatch<UserChangedEventData>, env: Bindings) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        await new SyncUserData(prisma).sync(batch)
    },
}
