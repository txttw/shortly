import { nanoid } from 'nanoid'
import { PrismaClientAccelerated } from '../lib/prismaClient'

export const addDays = (date: Date, days: number) => {
    date.setDate(date.getDate() + days)
    return date
}

export const readShortLinkFromDB = async (
    prisma: PrismaClientAccelerated,
    short: string
) =>
    await prisma.link.findFirst({
        where: {
            short,
        },
    })

export const generateStringWithValidation = async (
    len: number,
    validator: (str: string) => Promise<boolean>,
    retry = 5
) => {
    let str = nanoid(len)
    let i = 0
    for (; i < retry; i++) {
        const link = await validator(str)
        if (!link) {
            break
        }
    }
    if (i < retry) {
        return str
    }
}
