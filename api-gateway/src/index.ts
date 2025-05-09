import { Context, Hono } from 'hono'
import { sign as JWTSign, verify as JWTVerify } from 'hono/jwt'
import { z } from 'zod'
import 'zod-openapi/extend'
import prismaClients from '../lib/prismaClient'

import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'

import { proxiedRoutes } from './proxied-routes'
import {
    Scopes,
    CustomError,
    NotAllowedError,
    UnexpectedError,
    UnspecificBadRequestError,
    appDefaults,
    appConstants,
    verifyPassword,
    AuthorizationResult,
    sign as sign_hmac_sha256,
    UnauthorizedError,
} from 'shortly-shared'
import { SyncUserData } from './event-processing'
import { ServiceType } from './proxied-route-definition'
import { proxy } from './proxy-helper'
import { UserChangedEventData } from 'shortly-shared'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { JsonValue } from '@prisma/client/runtime/edge'
import { nanoid } from 'nanoid'
import { getCookie, setCookie } from 'hono/cookie'

type Bindings = {
    KV_API_KEYS: KVNamespace
    KV_REFRESH_TOKENS: KVNamespace
    DATABASE_URL: string
    SIGN_KEY: string
    SERVICE_USERS: Service
    SERVICE_LINKS: Service
    SERVICE_ANALYTICS: Service
    SERVICE_ORIGINS: { [Property in ServiceType]: string }
}

const serviceBindings: { [key: string]: keyof Bindings } = {
    [ServiceType.Users]: 'SERVICE_USERS',
    [ServiceType.Links]: 'SERVICE_LINKS',
    [ServiceType.Analytics]: 'SERVICE_ANALYTICS',
}

// APP CONFIG
// TODO We could read from DB
const appConfig = appDefaults

const app = new Hono<{ Bindings: Bindings }>()

/* APIKey and Token Routes */
const apiKeyReqSchema = z.object({
    id: z.string().uuid(),
})

const APIKeySchema = z.object({
    apiKey: z.string(),
})

app.post(
    '/apikeys/users/:id',
    describeRoute({
        description: 'Creates a APIKey for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(APIKeySchema),
                    },
                },
            },
        },
    }),
    zValidator('param', apiKeyReqSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        const user = await authorize(c.req.header('authorization'), c.env)
        if (!user) {
            throw new NotAllowedError()
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        try {
            const apiKey = nanoid(32)
            const hash = await sign_hmac_sha256(c.env.SIGN_KEY, apiKey)

            // Create the token
            const token = await prisma.apiKey.create({
                data: {
                    value: hash,
                    user: {
                        connect: {
                            id,
                            deletedAt: null,
                        },
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            scopes: true,
                        },
                    },
                },
            })

            // Cache token in KV
            await c.env.KV_API_KEYS.put(hash, JSON.stringify(token.user), {
                expirationTtl: appConstants.auth.ApiKeyCachTtl,
            })

            c.status(201)
            return c.json({ apiKey })
        } catch (err: any) {
            // this is a security feature, dont give too much information about the error
            throw new UnspecificBadRequestError()
        }
    }
)

const userCredentialsSchema = z.object({
    username: z.string(),
    password: z.string().min(appConfig.auth.pwMinLength),
})
const TokenRefreshSchema = z.object({
    token: z.string(),
    refresh: z.string(),
})

app.post(
    '/login',
    describeRoute({
        description: 'Creates a JWT token for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(TokenRefreshSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', userCredentialsSchema),
    async (c) => {
        const { username, password } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const user = await prisma.user.findFirst({
            where: {
                username,
                deletedAt: null,
            },
        })
        if (!user || !(await verifyPassword(user.password, password))) {
            throw new NotAllowedError()
        }

        const payload = {
            sub: user.id,
            scope: user.scopes,
            exp: Date.now() / 1e3 + appConstants.auth.JWTExpires,
        }

        const token = await JWTSign(payload, c.env.SIGN_KEY, 'HS256')

        const refreshId = nanoid()
        const fingerprint = nanoid()
        const fingerprintHash = await sign_hmac_sha256(
            c.env.SIGN_KEY,
            fingerprint
        )
        // refresh token can be invalidated bc it is statefull so use a longer expire time
        const refreshPayload = {
            sub: user.id,
            sid: refreshId,
            fingerprint: fingerprintHash,
            exp: Date.now() / 1e3 + appConstants.auth.JWTRefreshExpires,
        }

        const refresh = await JWTSign(refreshPayload, c.env.SIGN_KEY, 'HS256')

        c.env.KV_REFRESH_TOKENS.put(refreshId, user.id)

        setCookie(
            c,
            appConstants.auth.refreshFingerprintCookieName,
            fingerprint,
            {
                secure: true,
                httpOnly: true,
                maxAge: appConstants.auth.JWTRefreshExpires,
                sameSite: 'Strict',
            }
        )

        c.status(201)
        return c.json({ token, refresh })
    }
)

const refreshTokenSchema = z.object({
    refresh: z.string(),
})
const TokenSchema = z.object({
    token: z.string(),
})

app.post(
    '/refresh',
    describeRoute({
        description: 'Refreshes a JWT token for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(TokenSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', refreshTokenSchema),
    async (c) => {
        const { refresh } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const fingerprint = getCookie(
            c,
            appConstants.auth.refreshFingerprintCookieName
        )
        if (!fingerprint) {
            throw new NotAllowedError()
        }

        const refreshPayload = await JWTVerify(refresh, c.env.SIGN_KEY, 'HS256')

        const fingerprintHash = await sign_hmac_sha256(
            c.env.SIGN_KEY,
            fingerprint
        )

        if (refreshPayload.fingerprint !== fingerprintHash) {
            throw new NotAllowedError()
        }

        const userId = await c.env.KV_REFRESH_TOKENS.get(
            refreshPayload.sid as string
        )
        if (!userId) {
            throw new NotAllowedError()
        }

        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                deletedAt: null,
            },
        })

        if (!user) {
            throw new NotAllowedError()
        }

        const payload = {
            sub: user.id,
            scope: user.scopes,
            exp: Date.now() / 1e3 + appConstants.auth.JWTExpires,
        }

        const token = await JWTSign(payload, c.env.SIGN_KEY, 'HS256')

        c.status(201)
        return c.json({ token })
    }
)

const APIKeyCountSchema = z.object({
    count: z.number(),
})

app.get(
    '/apikeys',
    describeRoute({
        description: 'Get the token count associated to the user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(APIKeyCountSchema),
                    },
                },
            },
        },
    }),
    async (c) => {
        const authorization = c.req.header('authorization')
        const user = await authorize(authorization, c.env)
        if (!user) {
            throw new NotAllowedError()
        }

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const count = await prisma.apiKey.count({
            where: {
                userId: user.id,
            },
        })
        c.json({ count })
    }
)

app.get(
    '/api-gateway/doc/openapi',
    openAPISpecs(app, {
        documentation: {
            info: {
                title: 'Shortly - API Gatewa',
                version: '1.0.0',
                description: 'API endpoints are provided to manage API keys',
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

app.onError((err, c) => {
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

/* Authorization */

const authorize = async (
    keyOrToken: string | undefined,
    env: Bindings
): Promise<AuthorizationResult> => {
    if (!keyOrToken) return undefined

    if (keyOrToken.startsWith(appConstants.auth.JWTPrefix)) {
        return await authorizeToken(
            keyOrToken.replace(appConstants.auth.JWTPrefix, '').trim(),
            env
        )
    } else if (keyOrToken.startsWith(appConstants.auth.ApiKeyPrefix)) {
        return await authorizeAPIKey(
            keyOrToken.replace(appConstants.auth.ApiKeyPrefix, '').trim(),
            env
        )
    }
    // ok to return undefined
}

const authorizeAPIKey = async (
    apiKey: string,
    env: Bindings
): Promise<AuthorizationResult> => {
    try {
        const hash = await sign_hmac_sha256(env.SIGN_KEY, apiKey)

        if (hash) {
            // Check KV cache first
            const user = await env.KV_API_KEYS.get(hash)
            // Fallback to DB
            if (user) {
                return JSON.parse(user)
            } else {
                // Read the token
                const prisma = prismaClients.fetch(env.DATABASE_URL)
                const apiKey = await prisma.apiKey.findUnique({
                    where: {
                        value: hash,
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                scopes: true,
                            },
                        },
                    },
                })
                if (apiKey) {
                    // Cache token in KV
                    await env.KV_API_KEYS.put(
                        hash,
                        JSON.stringify(apiKey.user),
                        {
                            expirationTtl: appConstants.auth.ApiKeyCachTtl,
                        }
                    )
                    return apiKey.user as AuthorizationResult
                }
            }
        }
    } catch (err) {
        // ok to return undefined
    }
}

const authorizeToken = async (
    token: string,
    env: Bindings
): Promise<AuthorizationResult> => {
    try {
        const payload = await JWTVerify(token, env.SIGN_KEY, 'HS256')
        return {
            id: payload.sub as string,
            scopes: payload.scope as Array<Scopes>,
        }
    } catch (err) {
        // ok to return undefined
    }
}

/* Proxy */

for (const r of proxiedRoutes) {
    app[r.method](r.path, async (c) => {
        const auth: AuthorizationResult = r.auth
            ? await authorize(c.req.header('authorization'), c.env)
            : undefined

        if (r.auth && !auth) {
            throw new UnauthorizedError()
        }

        const origins = c.env.SERVICE_ORIGINS

        // We could rewrite the request e.g. from /users -> / if the service only handles requests related to 1 resource type, in this case User
        return proxy(
            `http://${origins[r.service]}${c.req.path}`,
            c.env[serviceBindings[r.service]] as Service,
            {
                ...c.req, // optional, specify only when forwarding all the request data (including credentials) is necessary.
                headers: {
                    ...c.req.header(),
                    // TODO handle this header
                    'X-Forwarded-For': '127.0.0.1',
                    'X-Forwarded-Host': c.req.header('host'),
                    Authorization: undefined, // do not propagate request headers contained in c.req.header('Authorization')
                    'X-Authenticated-User': auth?.id,
                    'X-User-Capabilities': JSON.stringify(auth?.scopes),
                },
            }
        )
    })
}

// This can provide authrozation for services as RPC
export class RemoteAuth extends WorkerEntrypoint<Bindings> {
    async authorize(tokenOrApiKey: string) {
        return await authorize(tokenOrApiKey, this.env)
    }
    async authorizeToken(token: string) {
        return await authorizeToken(token, this.env)
    }
    async authorizeAPIKey(apiKey: string) {
        return await authorizeAPIKey(apiKey, this.env)
    }
}

export default {
    fetch: app.fetch,
    async queue(batch: MessageBatch<UserChangedEventData>, env: Bindings) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        const results = await new SyncUserData(prisma).sync(batch)

        // If apiKey invalidation fails (from cache) it will expire soon
        // and authoriuation will fallback to query the DB
        const userIds = results.map((r) => r.model.id)
        const apikeys = await prisma.apiKey.findMany({
            where: {
                userId: { in: userIds },
            },
        })
        for (const apikey of apikeys) {
            await env.KV_API_KEYS.delete(apikey.value)
        }
    },
}
