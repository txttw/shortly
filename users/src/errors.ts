import {
    CustomError,
    ErrorMessageObject,
    ResourceAlreadyExists,
    StatusCode,
} from 'shortly-shared'

export class UserAlreadyExists extends ResourceAlreadyExists {
    constructor() {
        super('user')
    }
}

export class UserHasLinkError extends CustomError {
    status = 422 as StatusCode
    constructor() {
        super('Unable to delete. User has active associated links')
    }
    toMessage(): ErrorMessageObject {
        return {
            message: 'Unable to delete.  User has active associated links',
        }
    }
}
