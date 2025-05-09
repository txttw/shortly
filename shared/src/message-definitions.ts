import { Scopes } from './scopes'

export type WithOptional<T, K extends keyof T> = Omit<T, K> &
    Partial<Pick<T, K>>
export type PartialExceptVersion<T> = Partial<Omit<T, 'v'>> & { v: number }

export interface ModelChangedEventData {
    id: string
    v: number
    createdAt: Date
    deletedAt?: Date | null
}
export interface ResourceChangedEventDescriptor {
    id: number
    queue: string
    data: string
    sentAt?: Date | null
}
export interface UserChangedEventData extends ModelChangedEventData {
    username: string
    password: string
    scopes: Scopes[]
}
export interface LinkChangedEventData extends ModelChangedEventData {
    short: string
    long: string
    userId: string
    expiresAt: Date
}
export interface LinkUpdateProps extends Partial<LinkChangedEventData> {
    user?: {
        connect: {
            id: string
        }
    }
}
export interface LookupCreatedEventData {
    linkId: string
    timestamp: Date
}
