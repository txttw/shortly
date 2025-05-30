import { createMiddleware } from 'hono/factory'
import { Permissions, authJWT, UnauthenticatedError } from 'shortly-shared'

export const authenticateMiddleware = createMiddleware<{
    Bindings: {
        SIGN_KEY: string
    }
    Variables: {
        authUserId: string
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
