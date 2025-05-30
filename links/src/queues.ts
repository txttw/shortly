// Produce to queues
export enum QueuesToProduce {
    LINKS_ANALYTICS_QUEUE = 'shortly-links-analytics',
    LINKS_LOOKUPS_QUEUE = 'shortly-links-lookups',
    LINKS_USERS_QUEUE = 'shortly-links-users',
}

export const updateQueues = [
    QueuesToProduce.LINKS_ANALYTICS_QUEUE,
    QueuesToProduce.LINKS_LOOKUPS_QUEUE,
    QueuesToProduce.LINKS_USERS_QUEUE,
]
