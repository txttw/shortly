import {
    CustomError,
    ErrorMessageObject,
    ResourceAlreadyExists,
    StatusCode,
} from 'shortly-shared'

export class LinkAlreadyExists extends ResourceAlreadyExists {
    constructor() {
        super('short link')
    }
}
