import {
    LinkChangedEventData,
    LookupCreatedEventData,
    UserChangedEventData,
} from 'shortly-shared'
import { SyncServiceData } from 'shortly-shared'
import { PrismaClientAccelerated } from '../lib/prismaClient'

interface UserModelData {
    id: string
    v: number
    username: string
    deletedAt: Date | null
}

interface LinkModelData {
    count: number
    id: string
    v: number
    deletedAt: Date | null
    lastLookup: Date | null
    expiresAt: Date
    short: string
    long: string
    userId: string
}

export class SyncUserData extends SyncServiceData<
    PrismaClientAccelerated,
    UserChangedEventData,
    UserModelData
> {
    async createModel(data: UserChangedEventData): Promise<UserModelData> {
        return await this.prisma.user.create({
            data: {
                id: data.id,
                username: data.username,
                v: data.v,
                deletedAt: data.deletedAt,
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: UserChangedEventData
    ): Promise<UserModelData> {
        try {
            return await this.prisma.user.update({
                where,
                data: {
                    username: data.username,
                    v: data.v,
                    deletedAt: data.deletedAt,
                },
            })
        } catch (err) {
            console.log(err)
            throw err
        }
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<UserModelData | null> {
        return await this.prisma.user.findUnique({ where })
    }
}

export class SyncLinkData extends SyncServiceData<
    PrismaClientAccelerated,
    LinkChangedEventData,
    LinkModelData
> {
    async createModel(data: LinkChangedEventData): Promise<LinkModelData> {
        return await this.prisma.link.create({
            data: {
                id: data.id,
                short: data.short,
                long: data.long,
                userId: data.userId,
                v: data.v,
                deletedAt: data.deletedAt,
                expiresAt: data.expiresAt,
                // count: 0, - it has default 0 from schema
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: LinkChangedEventData
    ): Promise<LinkModelData> {
        return await this.prisma.$transaction(async (tx) => {
            const link = await tx.link.update({
                where,
                data: {
                    short: data.short,
                    long: data.long,
                    userId: data.userId,
                    v: data.v,
                    deletedAt: data.deletedAt,
                    expiresAt: data.expiresAt,
                },
            })
            // Cascade delete all related lookups
            // link has the last lookup timestamp and the count archived
            if (link.deletedAt) {
                await tx.lookup.deleteMany({
                    where: {
                        linkId: link.id,
                    },
                })
            }
            return link
        })
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<LinkModelData | null> {
        return await this.prisma.link.findUnique({ where })
    }
}

export async function saveLookups(
    prisma: PrismaClientAccelerated,
    batch: MessageBatch<LookupCreatedEventData>
) {
    const messagesByLinkId = batch.messages.reduce((agg, message) => {
        const linkId = message.body.linkId
        if (agg[linkId]) {
            agg[linkId].push(message)
        } else {
            agg[linkId] = [message]
        }
        return agg
    }, {} as { [key: string]: Message<LookupCreatedEventData>[] })
    const links = []
    for (const linkId in messagesByLinkId) {
        const existingLookups = await prisma.lookup.findMany({
            where: {
                linkId: linkId,
                timestamp: {
                    in: messagesByLinkId[linkId].map((m) => m.body.timestamp),
                },
            },
        })
        const newLookupData: LookupCreatedEventData[] = []
        for (const message of messagesByLinkId[linkId]) {
            const d = message.body
            const hasLookup = existingLookups.some(
                (l) => l.linkId === d.linkId && l.timestamp === d.timestamp
            )
            if (!hasLookup) {
                newLookupData.push(d)
            }
        }
        newLookupData.sort(
            (a, b) =>
                new Date(b.timestamp!).getTime() -
                new Date(a.timestamp!).getTime()
        )
        const [_, link] = await prisma.$transaction([
            prisma.lookup.createMany({ data: newLookupData }),
            prisma.link.update({
                where: {
                    id: linkId,
                },
                data: {
                    count: { increment: newLookupData.length },
                    lastLookup: newLookupData[0].timestamp,
                },
            }),
        ])
        const timestamps = newLookupData.map((lu) => lu.timestamp)
        links.push({ link, timestamps: timestamps.slice(0, 5) })
        // If the transaction did not throw we can ack the related messages
        for (const message of messagesByLinkId[linkId]) {
            message.ack()
        }
    }
    return links
}
