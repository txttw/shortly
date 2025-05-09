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

export const authorizeReadAnalytics = createMiddleware(async (c, next) => {
    if (
        !c.var.scopes.has(Scopes.ReadAnalytics) &&
        !c.var.scopes.has(Scopes.ReadAllAnalytics)
    ) {
        throw new NotAllowedError()
    }

    await next()
})
