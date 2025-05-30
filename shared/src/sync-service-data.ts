import {
    ModelChangedEventData,
    ResourceChangedEventDescriptor,
} from './message-definitions'
import { MessageBatch } from './queue-types'

export abstract class SyncServiceData<T, M extends ModelChangedEventData, R> {
    abstract createModel(data: M): Promise<R>
    abstract updateModel(where: { id: string; v: number }, data: M): Promise<R>
    abstract findUniqueModel(where: {
        id: string
        v: number
    }): Promise<R | null>

    constructor(protected prisma: T) {}
    createAck(ack: boolean, model: any = null) {
        return { ack, model }
    }
    async create(data: M) {
        try {
            const model = await this.createModel(data)
            // here we can ack the message
            return this.createAck(true, model)
        } catch (err: any) {
            console.log(err)
            if (err.name === 'PrismaClientKnownRequestError') {
                // P2002 - Unique constraint failed, record already exists, ack message
                if (err.code === 'P2002') {
                    return this.createAck(true)
                }
            }
            // else retry the message
            return this.createAck(false)
        }
    }
    async update(data: M) {
        try {
            const model = await this.updateModel(
                {
                    id: data.id,
                    v: data.v - 1,
                },
                data
            )

            // here we can ack the message
            return this.createAck(true, model)
        } catch (err: any) {
            if (err.name === 'PrismaClientKnownRequestError') {
                // P2025 - Record to update not found
                if (err.code === 'P2025') {
                    const model = await this.findUniqueModel({
                        id: data.id,
                        v: data.v,
                    })
                    // If model already at the correct version we can ack the message
                    if (model) {
                        return this.createAck(true, model)
                    }
                }
            }
            // else retry the message
            return this.createAck(false)
        }
    }
    async sync(
        batch: MessageBatch<ResourceChangedEventDescriptor>
    ): Promise<{ ack: boolean; model: R }[]> {
        const results = []
        for (const message of batch.messages) {
            const data = JSON.parse(message.body.data) as M
            // Delete is an update with deletedAt field
            const result =
                data.v === 0 ? await this.create(data) : await this.update(data)

            if (result.ack) {
                message.ack()
            } else {
                message.retry()
            }
            results.push(result)
        }
        return results
    }
}
