import { createMiddleware } from 'hono/factory'
import {
    Permissions,
    NotAllowedError,
    appConstants,
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

export const authorizeUserCreation = createMiddleware(async (c, next) => {
    if (!c.var.permissions.has(Permissions.User_Create)) {
        throw new NotAllowedError()
    }

    await next()
})

export const authorizeListUsers = createMiddleware(async (c, next) => {
    if (!c.var.permissions.has(Permissions.User_ReadAll)) {
        throw new NotAllowedError()
    }

    await next()
})

export const authorizeDeleteUsers = createMiddleware(async (c, next) => {
    if (!c.var.permissions.has(Permissions.User_DeleteAll)) {
        throw new NotAllowedError()
    }

    await next()
})
