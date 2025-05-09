import {
    LinkChangedEventData,
    LookupCreatedEventData,
    UserChangedEventData,
} from 'shortly-shared'
import { SyncServiceData } from 'shortly-shared'
import { PrismaClientAccelerated } from '../lib/prismaClient'

interface LinkModelData {
    id: string
    v: number
    deletedAt: Date | null
    expiresAt: Date
    userId: string
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
                userId: data.userId,
                v: data.v,
                deletedAt: data.deletedAt,
                expiresAt: data.expiresAt,
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: LinkChangedEventData
    ): Promise<LinkModelData> {
        return await this.prisma.link.update({
            where,
            data: {
                userId: data.userId,
                v: data.v,
                deletedAt: data.deletedAt,
                expiresAt: data.expiresAt,
            },
        })
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<LinkModelData | null> {
        return await this.prisma.link.findUnique({ where })
    }
}
