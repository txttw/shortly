import {
    createEventData,
    PartialExceptVersion,
    ResourceChangedEventDescriptor,
    UserChangedEventData,
} from 'shortly-shared'
import { SyncServiceData } from 'shortly-shared'
import { PrismaClientAccelerated } from '../lib/prismaClient'
import { updateQueues } from './queues'

interface ModelData {
    id: string
    username: string
    v: number
    deletedAt: Date | null
}

export class SyncUserData extends SyncServiceData<
    PrismaClientAccelerated,
    UserChangedEventData,
    ModelData
> {
    async createModel(data: UserChangedEventData): Promise<ModelData> {
        return await this.prisma.user.create({
            data: {
                id: data.id,
                v: data.v,
                username: data.username,
                deletedAt: data.deletedAt,
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: UserChangedEventData
    ): Promise<ModelData> {
        return await this.prisma.$transaction(async (tx) => {
            const user = await tx.user.update({
                where,
                data: {
                    v: data.v,
                    username: data.username,
                    deletedAt: data.deletedAt,
                },
            })
            // User service can decide if delete is restricted or not based on referenced links
            // In this service if there are still links attached to deleted user
            // we Cascade delete all related links. Its a soft delete on app level
            if (user.deletedAt) {
                const links = await tx.link.updateManyAndReturn({
                    where: {
                        userId: user.id,
                    },
                    data: {
                        deletedAt: new Date(),
                    },
                })

                const eventsData = links.reduce(
                    (prev, link) => [
                        ...prev,
                        ...createEventData<PartialExceptVersion<typeof link>>(
                            updateQueues,
                            link
                        ),
                    ],
                    [] as { queue: string; data: string }[]
                )
                await tx.linkChangedEvent.createMany({
                    data: eventsData,
                })
            }
            return user
        })
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<ModelData | null> {
        return await this.prisma.user.findUnique({ where })
    }
}

export async function handleDLQ(
    prisma: PrismaClientAccelerated,
    batch: MessageBatch<ResourceChangedEventDescriptor>
) {
    const eventIds = batch.messages.map((m) => m.body.id)
    await prisma.linkChangedEvent.updateMany({
        where: {
            id: {
                in: eventIds,
            },
        },
        data: {
            failedAt: new Date(),
        },
    })
}
