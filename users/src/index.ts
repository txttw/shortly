import { Hono } from 'hono/quick'
import { ZodError } from 'zod'
import 'zod-openapi/extend'
import { cors } from 'hono/cors'

import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'
import {
    AllUserHasLinkError,
    UserAlreadyExists,
    UserHasLinkError,
} from './errors'
import {
    corsOptions,
    CustomError,
    hashPassword,
    NotAllowedError,
    NotFoundError,
    PartialExceptVersion,
    Permissions,
    ResourceChangedEventDescriptor,
    UnexpectedError,
} from 'shortly-shared'
import { createEventData, sendEvents } from 'shortly-shared'
import {
    authenticateMiddleware,
    authorizeDeleteUsers,
    authorizeListUsers,
    authorizeUserCreation,
} from './middleware/authorization'
import { handleDLQ, SyncLinkData } from './event-processing'
import * as qs from 'qs-esm'
import {
    bulkDeleteParamSchema,
    createUserSchema,
    listQuerySchema,
    paginatedLinksResponseSchema,
    paramUserIdSchema,
    updateUserSchema,
    userResponeSchema,
} from './validation/users'

type DBBindings = {
    DATABASE_URL: string
}

type QueueBindings = {
    USERS_AUTH_QUEUE: Queue
    USERS_LINKS_QUEUE: Queue
    USERS_ANALYTICS_QUEUE: Queue
}

type Bindings = DBBindings & QueueBindings

// consume from queue
enum ConsumerQueues {
    LINKS_USERS_QUEUE = 'shortly-links-users',
    USERS_DLQ = 'shortly-users-dlq',
}

// Produce to queues
enum QueuesToProduce {
    USERS_AUTH_QUEUE = 'shortly-users-auth',
    USERS_LINKS_QUEUE = 'shortly-users-links',
    USERS_ANALYTICS_QUEUE = 'shortly-users-analytics',
}

export const updateQueues = [
    QueuesToProduce.USERS_AUTH_QUEUE,
    QueuesToProduce.USERS_LINKS_QUEUE,
    QueuesToProduce.USERS_ANALYTICS_QUEUE,
]

const queueBindings: { [key in QueuesToProduce]: keyof QueueBindings } = {
    [QueuesToProduce.USERS_AUTH_QUEUE]: 'USERS_AUTH_QUEUE',
    [QueuesToProduce.USERS_LINKS_QUEUE]: 'USERS_LINKS_QUEUE',
    [QueuesToProduce.USERS_ANALYTICS_QUEUE]: 'USERS_ANALYTICS_QUEUE',
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors(corsOptions))

// provide default permissions
const minimlaPermissions = [Permissions.Link_Create]

app.post(
    '/users',
    describeRoute({
        description: 'Creates a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(userResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeUserCreation,
    zValidator('json', createUserSchema),
    async (c) => {
        const { username, password, permissions = [] } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        // Check grant permissions
        if (!c.var.permissions.has(Permissions.Grant_All)) {
            // Grant_Owned means they can grant only what they own
            const allowed = c.var.permissions.intersection(new Set(permissions))
            if (
                !c.var.permissions.has(Permissions.Grant_Owned) ||
                allowed.size < permissions.length
            ) {
                throw new NotAllowedError()
            }
        }

        const hashed = await hashPassword(password)

        // Create the data and messages in one transaction
        try {
            const user = await prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        username,
                        password: hashed,
                        // Ensure minimal permissions are given
                        permissions: [
                            ...new Set(permissions).union(
                                new Set(minimlaPermissions)
                            ),
                        ].sort(),
                    },
                })
                await tx.userChangedEvent.createMany({
                    data: createEventData<typeof user>(updateQueues, user),
                })

                return user
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.userChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            c.status(201)
            return c.json({
                user: {
                    ...user,
                    password: undefined,
                    v: undefined,
                    deletedAt: undefined,
                },
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

app.patch(
    '/users/:id',
    describeRoute({
        description: 'Updates a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(userResponeSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', updateUserSchema),
    zValidator('param', paramUserIdSchema),
    authenticateMiddleware,
    async (c) => {
        const { id } = c.req.valid('param')
        const { username, permissions, password } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (
            id !== c.var.authUserId &&
            !c.var.permissions.has(Permissions.User_WriteAll)
        ) {
            throw new NotAllowedError()
        }

        // Check grant permissions
        if (permissions && !c.var.permissions.has(Permissions.Grant_All)) {
            // Grant_Owned means they can grant only what they own
            const allowed = c.var.permissions.intersection(new Set(permissions))
            if (
                !c.var.permissions.has(Permissions.Grant_Owned) ||
                allowed.size < permissions.length
            ) {
                throw new NotAllowedError()
            }
        }
        const data = {
            username,
            // Ensure minimal permissions not revoked
            permissions: permissions
                ? [
                      ...new Set(permissions).union(
                          new Set(minimlaPermissions)
                      ),
                  ].sort()
                : undefined,
            password: password ? await hashPassword(password) : undefined,
        }
        // Update the data and messages in one transaction
        try {
            const user = await prisma.$transaction(async (tx) => {
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
                    omit: {
                        password: true,
                    },
                })

                await tx.userChangedEvent.createMany({
                    data: createEventData<PartialExceptVersion<typeof user>>(
                        updateQueues,
                        { ...data, id: user.id, v: user.v }
                    ),
                })

                return user
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.userChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            return c.json({
                user: {
                    ...user,
                    v: undefined,
                    deletedAt: undefined,
                },
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
                        schema: resolver(userResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', paramUserIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (
            id !== c.var.authUserId &&
            !c.var.permissions.has(Permissions.User_DeleteAll)
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
            const user = await prisma.$transaction(async (tx) => {
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
                    omit: {
                        password: true,
                    },
                })
                await tx.userChangedEvent.createMany({
                    data: createEventData<PartialExceptVersion<typeof user>>(
                        updateQueues,
                        { id: user.id, deletedAt: user.deletedAt, v: user.v }
                    ),
                })

                return user
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.userChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            return c.json({
                user: { ...user, v: undefined },
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

app.post(
    '/users/bulk/delete',
    describeRoute({
        description: 'Bulk delete user resources',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(userResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeDeleteUsers,
    zValidator('json', bulkDeleteParamSchema),
    async (c) => {
        const { ids } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (!c.var.permissions.has(Permissions.User_DeleteAll)) {
            throw new NotAllowedError()
        }

        // Update the data and messages in one transaction
        try {
            const users = await prisma.$transaction(async (tx) => {
                const userIdsWithoutLinks = await tx.user.findMany({
                    where: {
                        id: {
                            in: ids,
                        },
                        links: {
                            none: {
                                expiresAt: { gt: new Date() },
                                deletedAt: null,
                            },
                        },
                    },
                    select: {
                        id: true,
                    },
                })
                if (userIdsWithoutLinks.length === 0) {
                    throw new AllUserHasLinkError()
                }
                const deletedUsers = await tx.user.updateManyAndReturn({
                    where: {
                        id: {
                            in: userIdsWithoutLinks.map((u) => u.id),
                        },
                        deletedAt: null,
                    },
                    data: {
                        deletedAt: new Date(),
                        v: {
                            increment: 1,
                        },
                    },
                    omit: {
                        password: true,
                    },
                })
                let eventData = []
                for (const user of deletedUsers) {
                    const data = createEventData<
                        PartialExceptVersion<typeof user>
                    >(updateQueues, {
                        id: user.id,
                        deletedAt: user.deletedAt,
                        v: user.v,
                    })
                    eventData.push(...data)
                }
                await tx.userChangedEvent.createMany({
                    data: eventData,
                })

                return deletedUsers
            })

            // Send events
            try {
                const send = async (queue: string, data: any) =>
                    await c.env[queueBindings[queue as QueuesToProduce]].send(
                        data
                    )
                await sendEvents(prisma.userChangedEvent, send)
            } catch (err) {
                // If something fails we can retry later
            }

            return c.json({
                deleted: users.map((data) => data.id),
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
    '/users/:id',
    describeRoute({
        description: 'Get a user resource',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(userResponeSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', paramUserIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        if (
            id !== c.var.authUserId &&
            !c.var.permissions.has(Permissions.User_ReadAll)
        ) {
            throw new NotAllowedError()
        }

        const user = await prisma.user.findUnique({
            where: {
                id,
                deletedAt: null,
            },
            omit: {
                password: true,
                v: true,
                deletedAt: true,
            },
        })

        if (user) {
            return c.json({ user })
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
                        schema: resolver(paginatedLinksResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    authorizeListUsers,
    async (c) => {
        const search = new URL(c.req.url).search.slice(1)
        const query = listQuerySchema.parse(qs.parse(search))

        const page = query?.page || 1
        const limit = query?.limit || 10

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const users = await prisma.user.findMany({
            where: {
                ...(query?.where || {}),
                deletedAt: null,
            },
            orderBy: query?.sort || undefined,
            omit: {
                deletedAt: true,
                password: true,
                v: true,
            },
            skip: (page - 1) * limit,
            take: limit + 1,
        })

        const hasNextPage = users.length > limit
        if (hasNextPage) users.pop()

        return c.json({
            docs: users,
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
    '/users/schema/openapi',
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
    async queue(batch: MessageBatch, env: Bindings) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        switch (batch.queue) {
            case ConsumerQueues.LINKS_USERS_QUEUE:
                await new SyncLinkData(prisma).sync(
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )
                break
            case ConsumerQueues.USERS_DLQ:
                await handleDLQ(
                    prisma,
                    batch as MessageBatch<ResourceChangedEventDescriptor>
                )
                break
        }
    },
}
