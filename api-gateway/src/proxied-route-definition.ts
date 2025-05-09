export enum Method {
    ALL = 'all',
    GET = 'get',
    POST = 'post',
    PUT = 'put',
    PATCH = 'patch',
    DELETE = 'delete',
}

export enum ServiceType {
    Users = 'users',
    Links = 'links',
    Analytics = 'analytics',
}

export interface ProxiedRouteDefinition {
    method: Method
    path: string
    auth?: boolean
    service: ServiceType
    match?: string
    rewrite?: string
}
