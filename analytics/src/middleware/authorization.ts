import { createMiddleware } from 'hono/factory'
import {
    Permissions,
    NotAllowedError,
    authJWT,
    UnauthenticatedError,
} from 'shortly-shared'

export const authenticateMiddleware = createMiddleware<{
    Bindings: {
        SIGN_KEY: string
    }
    Variables: {
        authUserId: string | undefined
        permissions: Set<Permissions>
    }
}>(async (c, next) => {
    try {
        const auth = await authJWT(
            c.env.SIGN_KEY,
            c.req.header('authorization')
        )
        c.set('authUserId', auth.id)
        c.set('permissions', new Set(auth.permissions))
        await next()
    } catch (err: unknown) {
        throw new UnauthenticatedError()
    }
})

export const authorizeReadAnalytics = createMiddleware(async (c, next) => {
    if (!c.var.permissions.has(Permissions.Analytics_Read)) {
        throw new NotAllowedError()
    }

    await next()
})
