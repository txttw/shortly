import { UserChangedEventData } from 'shortly-shared'
import { SyncServiceData } from 'shortly-shared'
import { PrismaClientAccelerated } from '../lib/prismaClient'

interface ModelData {
    id: string
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
                deletedAt: data.deletedAt,
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: UserChangedEventData
    ): Promise<ModelData> {
        return await this.prisma.user.update({
            where,
            data: {
                v: data.v,
                deletedAt: data.deletedAt,
            },
        })
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<ModelData | null> {
        return await this.prisma.user.findUnique({ where })
    }
}
