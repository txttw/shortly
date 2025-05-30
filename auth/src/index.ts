import { Hono } from 'hono/quick'
import { sign as JWTSign, verify as JWTVerify } from 'hono/jwt'
import prismaClients from '../lib/prismaClient'
import { describeRoute, openAPISpecs } from 'hono-openapi'
import { resolver, validator as zValidator } from 'hono-openapi/zod'
import {
    CustomError,
    UnexpectedError,
    UnspecificBadRequestError,
    appConstants,
    verifyPassword,
    sign as sign_hmac_sha256,
    UnauthenticatedError,
    sleep,
    corsOptions,
    base64Decode,
    ResourceChangedEventDescriptor,
} from 'shortly-shared'
import { SyncUserData } from './event-processing'

import { nanoid } from 'nanoid'
import { getCookie, setCookie } from 'hono/cookie'
import { cors } from 'hono/cors'
import { JWTPayload } from 'hono/utils/jwt/types'
import {
    APIKeyCountResponseSchema,
    APIKeyResponseSchema,
    APIKeySchema,
    apiKeyUserIdSchema,
    JWTResponseSchema,
    refreshTokenSchema,
    userCredentialsSchema,
} from './validation/auth'
import { authenticateMiddleware } from './middleware/authorization'

type Bindings = {
    KV_REFRESH_TOKENS: KVNamespace
    DATABASE_URL: string
    SIGN_KEY: string
    ENVIRONMENT: string
}

interface RefreshPayloadType extends JWTPayload {
    sub: string
    sid: string
    fingerprint: string
    exp: number
}

const app = new Hono<{ Bindings: Bindings }>()

/* APIKey and Token Routes */

app.use(
    '*',
    cors({
        ...corsOptions,
        exposeHeaders: ['set-cookie'],
        credentials: true,
    })
)

app.post(
    '/auth/login',
    describeRoute({
        description: 'Creates a JWT token for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(JWTResponseSchema),
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
            await sleep(4000)
            throw new UnauthenticatedError()
        }

        const payload = {
            sub: user.id,
            name: user.username,
            perm: user.permissions,
            exp: Date.now() / 1e3 + appConstants.auth.JWTExpires,
        }

        const token = await JWTSign(
            payload,
            base64Decode(c.env.SIGN_KEY),
            'HS256'
        )

        const refreshId = nanoid()
        const fingerprint = nanoid()
        const fingerprintHash = await sign_hmac_sha256(
            c.env.SIGN_KEY,
            fingerprint
        )
        // refresh token can be invalidated bc it is statefull so use a longer expire time
        const refreshPayload: RefreshPayloadType = {
            sub: user.id,
            sid: refreshId,
            fingerprint: fingerprintHash,
            exp: Date.now() / 1e3 + appConstants.auth.JWTRefreshExpires,
        }

        const refresh = await JWTSign(
            refreshPayload,
            base64Decode(c.env.SIGN_KEY),
            'HS256'
        )

        await c.env.KV_REFRESH_TOKENS.put(user.id, refreshId, {
            expirationTtl: appConstants.auth.JWTRefreshExpires,
        })

        const isLocal = c.env.ENVIRONMENT === 'local'
        setCookie(
            c,
            isLocal
                ? appConstants.auth.refreshFingerprintCookie.local
                : appConstants.auth.refreshFingerprintCookie.secure,
            fingerprint,
            {
                secure: !isLocal,
                httpOnly: true,
                maxAge: appConstants.auth.JWTRefreshExpires,
                sameSite: 'none',
            }
        )

        c.status(201)
        return c.json({
            token,
            refresh,
        })
    }
)

app.post(
    '/auth/refresh',
    describeRoute({
        description: 'Refreshes a JWT token for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(JWTResponseSchema),
                    },
                },
            },
        },
    }),
    zValidator('json', refreshTokenSchema),
    async (c) => {
        const { refresh } = c.req.valid('json')
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        const isLocal = c.env.ENVIRONMENT === 'local'
        const fingerprint = getCookie(
            c,
            isLocal
                ? appConstants.auth.refreshFingerprintCookie.local
                : appConstants.auth.refreshFingerprintCookie.secure
        )

        if (!fingerprint) {
            throw new UnauthenticatedError()
        }

        const refreshPayload = (await JWTVerify(
            refresh,
            base64Decode(c.env.SIGN_KEY),
            'HS256'
        )) as RefreshPayloadType

        const fingerprintHash = await sign_hmac_sha256(
            c.env.SIGN_KEY,
            fingerprint
        )

        if (refreshPayload.fingerprint !== fingerprintHash) {
            throw new UnauthenticatedError()
        }
        const userId = refreshPayload.sub

        const refreshId = await c.env.KV_REFRESH_TOKENS.get(userId)
        if (!refreshId || refreshId !== refreshPayload.sid) {
            throw new UnauthenticatedError()
        }

        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                deletedAt: null,
            },
        })

        if (!user) {
            throw new UnauthenticatedError()
        }

        const payload = {
            sub: user.id,
            perm: user.permissions,
            name: user.username,
            exp: Date.now() / 1e3 + appConstants.auth.JWTExpires,
        }

        const token = await JWTSign(
            payload,
            base64Decode(c.env.SIGN_KEY),
            'HS256'
        )

        c.status(201)
        return c.json({ token })
    }
)

app.post(
    '/auth/logout',
    describeRoute({
        description: 'Sign out',
        responses: {
            201: {
                description: 'Successful sign out',
            },
        },
    }),
    authenticateMiddleware,
    async (c) => {
        // If it fails kv store has expiry and the next login will overwrite
        await c.env.KV_REFRESH_TOKENS.delete(c.var.authUserId)

        return c.newResponse(null, 201)
    }
)

app.post(
    '/auth/apikeys/users/:id',
    describeRoute({
        description: 'Creates an APIKey for a user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(APIKeyResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', apiKeyUserIdSchema),
    async (c) => {
        const { id } = c.req.valid('param')

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)

        try {
            const apiKey = nanoid(32)
            const hash = await sign_hmac_sha256(c.env.SIGN_KEY, apiKey)

            // Create the token
            await prisma.apiKey.create({
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
                            permissions: true,
                        },
                    },
                },
            })

            c.status(201)
            return c.json({ apiKey })
        } catch (err: any) {
            // this is a security feature, dont give too much information about the error
            throw new UnspecificBadRequestError()
        }
    }
)

app.post(
    '/auth/apikeys/token',
    describeRoute({
        description: 'Exchanges an APIKey for a token',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(JWTResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    zValidator('param', APIKeySchema),
    async (c) => {
        const { apiKey } = c.req.valid('param')

        //const auth = await authorizeAPIKey(apiKey, c.env)

        const hash = await sign_hmac_sha256(c.env.SIGN_KEY, apiKey)

        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const apiKeyModel = await prisma.apiKey.findUnique({
            where: {
                value: hash,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        permissions: true,
                        username: true,
                    },
                },
            },
        })

        if (!apiKeyModel) {
            throw new UnauthenticatedError()
        }

        const payload = {
            sub: apiKeyModel.user.id,
            perm: apiKeyModel.user.permissions,
            name: apiKeyModel.user.username,
            exp: Date.now() / 1e3 + appConstants.auth.JWTForAPIKeyExpires,
        }

        const token = await JWTSign(
            payload,
            base64Decode(c.env.SIGN_KEY),
            'HS256'
        )

        c.status(201)
        return c.json({ token })
    }
)

app.get(
    '/auth/apikeys',
    describeRoute({
        description: 'Get the token count associated to the user',
        responses: {
            200: {
                description: 'Successful response',
                content: {
                    'application/json': {
                        schema: resolver(APIKeyCountResponseSchema),
                    },
                },
            },
        },
    }),
    authenticateMiddleware,
    async (c) => {
        const prisma = prismaClients.fetch(c.env.DATABASE_URL)
        const count = await prisma.apiKey.count({
            where: {
                userId: c.var.authUserId,
            },
        })
        return c.json({ count })
    }
)

app.get(
    '/auth/schema/openapi',
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
    console.log(err)
    const e = err instanceof CustomError ? err : new UnexpectedError()
    c.status(e.status)
    return c.json(e.toMessage())
})

export default {
    fetch: app.fetch,
    async queue(
        batch: MessageBatch<ResourceChangedEventDescriptor>,
        env: Bindings
    ) {
        const prisma = prismaClients.fetch(env.DATABASE_URL)
        await new SyncUserData(prisma).sync(batch)
    },
}
