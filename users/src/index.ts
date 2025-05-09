import { Hono } from 'hono/quick'
import { z } from 'zod'
import 'zod-openapi/extend'

import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'
import { UserAlreadyExists, UserHasLinkError } from './errors'
import {
    appDefaults,
    CustomError,
    hashPassword,
    LinkChangedEventData,
    NotAllowedError,
    NotFoundError,
    PartialExceptVersion,
    Scopes,
    UnexpectedError,
} from 'shortly-shared'
import { createEventData, sendEvents } from 'shortly-shared'
import {
    authorizeListUsers,
    authorizeUserCreation,
    getAuthorizationData,
} from './middleware/authorization'
import { SyncLinkData } from './event-processing'

type DBBindings = {
    DATABASE_URL: string
}

type QueueBindings = {
    USERS_API_GW_QUEUE: Queue
    USERS_LINKS_QUEUE: Queue
    USERS_ANALYTICS_QUEUE: Queue
}

type Bindings = DBBindings & QueueBindings

enum Queues {
    USERS_API_GW_QUEUE = 'shortly-users-api-gw',
    USERS_LINKS_QUEUE = 'shortly-users-links',
    USERS_ANALYTICS_QUEUE = 'shortly-users-analytics',
}

const queueBindings: { [key in Queues]: keyof QueueBindings } = {
    [Queues.USERS_API_GW_QUEUE]: 'USERS_API_GW_QUEUE',
    [Queues.USERS_LINKS_QUEUE]: 'USERS_LINKS_QUEUE',
    [Queues.USERS_ANALYTICS_QUEUE]: 'USERS_ANALYTICS_QUEUE',
}

const app = new Hono<{ Bindings: Bindings }>()

const createBodySchema = z.object({
    username: z.string().min(2).max(25).openapi({ example: 'john' }),
    password: z.string().min(appDefaults.auth.pwMinLength),
})

const UserSchema = z.object({
    username: z.string().openapi({ example: 'steven' }),
    id: z.string(),
    createdAt: z.date(),
})

app.post(
    '/users',
    describeRoute({
        description: 'Creates a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(UserSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    authorizeUserCreation,
    zValidator('json', createBodySchema),
    async (c) => {
        const { username, password } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // provide default scopes, it can be changed later with user update
        const defaultScopes = [Scopes.CreateLink, Scopes.ReadAnalytics]

        const hashed = await hashPassword(password)

        // Create the data and messages in one transaction
        try {
            const { user, events } = await prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        username,
                        password: hashed,
                        scopes: defaultScopes,
                    },
                })
                const events = await tx.userChangedEvent.createManyAndReturn({
                    data: createEventData<typeof user>(
                        [
                            Queues.USERS_API_GW_QUEUE,
                            Queues.USERS_LINKS_QUEUE,
                            Queues.USERS_ANALYTICS_QUEUE,
                        ],
                        user
                    ),
                })

                return { user, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.userChangedEvent,
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
            return c.json({
                ...user,
                password: undefined,
                v: undefined,
                deletedAt: undefined,
            })
        } catch (err: any) {
            if (
                err.name === 'PrismaClientKnownRequestError' &&
                err.meta?.modelName === 'User'
            ) {
                // P2002 - Unique constraint failed, record already exists, ack message
                if (err.code === 'P2002') {
                    throw new UserAlreadyExists()
                }
            }
            // rethrow
            throw err
        }
    }
)

const updateBodySchema = z
    .object({
        username: z
            .optional(z.string().min(2).max(25))
            .openapi({ example: 'john' }),
        scopes: z.optional(z.array(z.nativeEnum(Scopes))),
        password: z.optional(z.string().min(appDefaults.auth.pwMinLength)),
    })
    .refine(
        ({ username, scopes }) =>
            username !== undefined || scopes !== undefined,
        { message: 'One of the fields must be defined' }
    )
const updateParamSchema = z.object({
    id: z.string().uuid(),
})

app.patch(
    '/users/:id',
    describeRoute({
        description: 'Updates a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(UserSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', updateBodySchema),
    zValidator('param', updateParamSchema),
    getAuthorizationData,
    async (c) => {
        const { id } = c.req.valid('param')
        const { username, scopes, password } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (
            id !== c.var.authUserId &&
            !c.var.scopes.has(Scopes.WriteAllUsers)
        ) {
            throw new NotAllowedError()
        }

        if (scopes) {
            const allowed = c.var.scopes.intersection(new Set(scopes))
            if (allowed.size < scopes.length) {
                throw new NotAllowedError()
            }
        }
        const data = {
            username,
            scopes,
            password: password ? await hashPassword(password) : undefined,
        }
        // Update the data and messages in one transaction
        try {
            const { user, events } = await prisma.$transaction(async (tx) => {
                const user = await tx.user.update({
                    where: {
                        id,
                        deletedAt: null,
                    },
                    data: {
                        ...data,
                        v: {
                            increment: 1,
                        },
                    },
                })

                const events = await tx.userChangedEvent.createManyAndReturn({
                    data: createEventData<PartialExceptVersion<typeof user>>(
                        [
                            Queues.USERS_API_GW_QUEUE,
                            Queues.USERS_LINKS_QUEUE,
                            Queues.USERS_ANALYTICS_QUEUE,
                        ],
                        { ...data, id: user.id, v: user.v }
                    ),
                })

                return { user, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.userChangedEvent,
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
            return c.json({
                ...user,
                password: undefined,
                v: undefined,
                deletedAt: undefined,
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

app.delete(
    '/users/:id',
    describeRoute({
        description: 'Delete a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(UserSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    zValidator('param', updateParamSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (
            id !== c.var.authUserId &&
            !c.var.scopes.has(Scopes.WriteAllUsers)
        ) {
            throw new NotAllowedError()
        }

        // Check for links, we dont need this in the transaction
        // as it is not the source of truth in terms of Links
        // Alternatively we could RPC to the links service for sync check
        // But based on the business logic and user behaviour
        // we can accept if the link created event hasnt propagated and we delete the user
        // It is a soft delete, easily reversable
        const hasLink = await prisma.link.findFirst({
            where: {
                userId: id,
                expiresAt: { gt: new Date() },
                deletedAt: null,
            },
        })
        if (hasLink) {
            throw new UserHasLinkError()
        }

        // Update the data and messages in one transaction
        try {
            const { user, events } = await prisma.$transaction(async (tx) => {
                const user = await tx.user.update({
                    where: {
                        id,
                        deletedAt: null,
                    },
                    data: {
                        deletedAt: new Date(),
                        v: {
                            increment: 1,
                        },
                    },
                })
                const events = await tx.userChangedEvent.createManyAndReturn({
                    data: createEventData<PartialExceptVersion<typeof user>>(
                        [
                            Queues.USERS_API_GW_QUEUE,
                            Queues.USERS_LINKS_QUEUE,
                            Queues.USERS_ANALYTICS_QUEUE,
                        ],
                        { id: user.id, deletedAt: user.deletedAt, v: user.v }
                    ),
                })

                return { user, events }
            })

            // Send events
            // This can fail partially or in total we will retry from a workflow
            // Workflow has internal ways to retry multiple timess
            const send = async (queue: string, data: any) =>
                await c.env[queueBindings[queue as Queues]].send(data)

            try {
                const sentCount = await sendEvents(
                    prisma.userChangedEvent,
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
            return c.json({ ...user, password: undefined, v: undefined })
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
    '/users/:id',
    describeRoute({
        description: 'Get a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(UserSchema),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    zValidator('param', updateParamSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (id !== c.var.authUserId && !c.var.scopes.has(Scopes.ReadAllUsers)) {
            throw new NotAllowedError()
        }

        const user = await prisma.user.findUnique({
            where: {
                id,
                deletedAt: null,
            },
        })
        if (user) {
            c.status(200)
            return c.json({
                ...user,
                password: undefined,
                v: undefined,
                deletedAt: undefined,
            })
        }

        throw new NotFoundError()
    }
)

app.get(
    '/users',
    describeRoute({
        description: 'List user resources',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(z.array(UserSchema)),
                    },
                },
            },
        },
    }),
    getAuthorizationData,
    authorizeListUsers,
    async (c) => {
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const users = await prisma.user.findMany({
            where: {
                deletedAt: null,
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: 100,
        })

        return c.json({
            users: users.map((user) => ({
                ...user,
                password: undefined,
                v: undefined,
                deletedAt: undefined,
            })),
        })
    }
)

app.onError((err, c) => {
    console.log(err)
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

app.get(
    '/users/doc/openapi',
    openAPISpecs(app, {
        documentation: {
            info: {
                title: 'Shortly - Users service',
                version: '1.0.0',
                description: 'Managing users',
            },
        },
    })
)

export default {
    fetch: app.fetch,
    async queue(batch: MessageBatch<LinkChangedEventData>, env: Bindings) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        const results = await new SyncLinkData(prisma).sync(batch)
    },
}
