import { PrismaClient } from '../src/generated/prisma/edge'
import { withAccelerate } from '@prisma/extension-accelerate'

var prismaClient: PrismaClientAccelerated | null = null

function getClient(datasourceUrl: string) {
    return new PrismaClient({
        datasourceUrl,
    }).$extends(withAccelerate())
}

const prismaClients = {
    fetch(datasourceUrl: string) {
        if (!prismaClient) {
            prismaClient = getClient(datasourceUrl)
        }
        return prismaClient
    },
}

export default prismaClients

// Define a type for the accelerated client.
export type PrismaClientAccelerated = ReturnType<typeof getClient>
