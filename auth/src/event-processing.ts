import { UserChangedEventData } from 'shortly-shared'
import { SyncServiceData } from 'shortly-shared'
import { PrismaClientAccelerated } from '../lib/prismaClient'
import { JsonValue } from '@prisma/client/runtime/edge'

interface ModelData {
    permissions: JsonValue
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
                username: data.username,
                v: data.v,
                permissions: data.permissions,
                password: data.password,
                deletedAt: data.deletedAt,
            },
        })
    }
    async updateModel(
        where: { id: string; v: number },
        data: UserChangedEventData
    ): Promise<ModelData> {
        const user = await this.prisma.user.update({
            where,
            data: {
                username: data.username,
                v: data.v,
                permissions: data.permissions,
                password: data.password,
                deletedAt: data.deletedAt,
            },
        })
        return user
    }
    async findUniqueModel(where: {
        id: string
        v: number
    }): Promise<ModelData | null> {
        return await this.prisma.user.findUnique({ where })
    }
}
