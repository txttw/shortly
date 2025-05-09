import { ResourceChangedEventDescriptor } from './message-definitions'

export function createEventData<T>(queues: string[], data: T) {
    const eventData: { queue: string; data: string }[] = []
    for (const queue of queues) {
        eventData.push({
            queue,
            data: JSON.stringify(data),
        })
    }
    return eventData
}

export async function sendEvents(
    eventModelDelegate: any,
    events: ResourceChangedEventDescriptor[],
    send: (queue: string, data: any) => Promise<void>
) {
    const processedIds: number[] = []
    for (const event of events) {
        try {
            await send(event.queue, JSON.parse(event.data))
            processedIds.push(event.id)
        } catch (err) {
            // We will retry later
        }
    }
    // After successfull event publishing we can set the sentAt field.
    // If event sending is repeated because of concurency or the following update fails
    // no big deal it can be resent, recievers has to be omnipotent,
    // queue does not ensure max 1 delivery either
    const batchInfo = await eventModelDelegate.updateMany({
        where: {
            id: { in: processedIds },
        },
        data: {
            sentAt: new Date(),
        },
    })
    return batchInfo.count
}
