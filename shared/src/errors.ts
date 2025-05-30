import { StatusCode } from './status-codes'

export class JwtTokenInvalidFormat extends Error {
    constructor() {
        super('Jwt invalid format')
    }
}
export class JwtTokenInvalidExpired extends Error {
    constructor() {
        super('Jwt expired')
    }
}
export class JwtTokenInvalidSignature extends Error {
    constructor() {
        super('Jwt invalid signature')
    }
}
export class JwtInvalidHeader extends Error {
    constructor() {
        super(
            'Jwt invalid header. It should be an Authorization header with a Bearer token'
        )
    }
}

export interface ErrorMessageObject {
    message: string
}

export abstract class CustomError extends Error {
    abstract status: StatusCode
    abstract toMessage(): ErrorMessageObject
}

export class UnexpectedError extends CustomError {
    status = 500 as StatusCode
    constructor() {
        super('Unexpected error')
    }
    toMessage(): ErrorMessageObject {
        return { message: 'Unexpected error' }
    }
}

export class NotFoundError extends CustomError {
    status = 404 as StatusCode
    constructor() {
        super('Not found')
    }
    toMessage(): ErrorMessageObject {
        return { message: 'Not found' }
    }
}

export class NotAllowedError extends CustomError {
    status = 403 as StatusCode
    constructor() {
        super('Not allowed')
    }
    toMessage(): ErrorMessageObject {
        return { message: 'Not allowed' }
    }
}

export class UnauthenticatedError extends CustomError {
    status = 401 as StatusCode
    constructor() {
        super('Not authenticated')
    }
    toMessage(): ErrorMessageObject {
        return { message: 'Not authenticated' }
    }
}

export class UnspecificBadRequestError extends CustomError {
    status = 400 as StatusCode
    constructor() {
        super('Operation can not be executed')
    }
    toMessage(): ErrorMessageObject {
        return { message: 'Operation can not be executed' }
    }
}

export class ResourceAlreadyExists extends CustomError {
    status = 400 as StatusCode
    constructor(public resource: string) {
        super(`${resource} already exists`)
    }
    toMessage(): ErrorMessageObject {
        return { message: `${this.resource} already exists` }
    }
}
