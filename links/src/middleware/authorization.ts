import { createMiddleware } from 'hono/factory'
import {
    Permissions,
    NotAllowedError,
    UnauthenticatedError,
    authJWT,
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
        console.log(err)
        throw new UnauthenticatedError()
    }
})

export const authorizeLinkCreation = createMiddleware(async (c, next) => {
    if (!c.var.permissions.has(Permissions.Link_Create)) {
        throw new NotAllowedError()
    }

    await next()
})
