import {
    Method,
    ProxiedRouteDefinition,
    ServiceType,
} from './proxied-route-definition'

// Rewrites are not used currently (ignored)

export const proxiedRoutes: ProxiedRouteDefinition[] = [
    // User routes
    {
        method: Method.GET,
        path: '/users/doc/openapi',
        service: ServiceType.Users,
    },
    {
        method: Method.POST,
        path: '/users',
        auth: true,
        service: ServiceType.Users,
    },
    {
        method: Method.PATCH,
        path: '/users/:id',
        auth: true,
        service: ServiceType.Users,
    },
    {
        method: Method.DELETE,
        path: '/users/:id',
        auth: true,
        service: ServiceType.Users,
    },
    {
        method: Method.GET,
        path: '/users/:id',
        auth: true,
        service: ServiceType.Users,
    },
    {
        method: Method.GET,
        path: '/users',
        auth: true,
        service: ServiceType.Users,
    },
    {
        method: Method.GET,
        path: '/users/:id',
        auth: true,
        service: ServiceType.Users,
    },
    // Link routes
    {
        method: Method.POST,
        path: '/links',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.PATCH,
        path: '/links/:id',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.DELETE,
        path: '/links/:id',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.GET,
        path: '/links/:id',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.GET,
        path: '/links',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.GET,
        path: '/links/:id',
        auth: true,
        service: ServiceType.Links,
    },
    {
        method: Method.GET,
        path: '/links/doc/openapi',
        service: ServiceType.Links,
    },
    // Analytics routes
    {
        method: Method.GET,
        path: '/analytics/:short',
        auth: true,
        service: ServiceType.Analytics,
    },
    {
        method: Method.GET,
        path: '/analytics/doc/openapi',
        service: ServiceType.Analytics,
    },
]
