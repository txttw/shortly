import { ResourceAlreadyExists } from 'shortly-shared'

export class LinkAlreadyExists extends ResourceAlreadyExists {
    constructor() {
        super('short link')
    }
}
