import { Scopes } from './scopes'

export type AuthorizationResult =
    | {
          id: string
          scopes: Array<Scopes>
      }
    | undefined
