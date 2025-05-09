import { createMiddleware } from 'hono/factory'
import { Scopes, NotAllowedError } from 'shortly-shared'

// This middleware gets auth data provided by gateway service.
export const getAuthorizationData = createMiddleware<{
    Variables: {
        authUserId: string | undefined
        scopes: Set<Scopes>
    }
}>(async (c, next) => {
    c.set('authUserId', c.req.header('X-Authenticated-User'))
    c.set(
        'scopes',
        new Set(JSON.parse(c.req.header('X-User-Capabilities') || '[]'))
    )
    await next()
})

export const authorizeUserCreation = createMiddleware(async (c, next) => {
    if (!c.var.scopes.has(Scopes.CreateUser)) {
        throw new NotAllowedError()
    }

    await next()
})

export const authorizeListUsers = createMiddleware(async (c, next) => {
    if (!c.var.scopes.has(Scopes.ReadAllUsers)) {
        throw new NotAllowedError()
    }

    await next()
})
