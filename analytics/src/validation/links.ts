import { getSortSchema } from 'shortly-shared'
import { z } from 'zod'
import 'zod-openapi/extend'
import {
    dateQuerySchema,
    idQuerySchema,
    limitQuerySchema,
    pageQuerySchema,
    PaginationSchema,
    textQuerySchema,
    uIntRange,
} from './common'

const lookupTimestampQuerySchema = z.object({
    timestamp: z.optional(dateQuerySchema),
})

const whereQueryFields = {
    id: z.optional(idQuerySchema),
    short: z.optional(textQuerySchema),
    long: z.optional(textQuerySchema),
    expiresAt: z.optional(dateQuerySchema),
    lastLookup: z.optional(dateQuerySchema),
    count: z.optional(uIntRange),
    user: z.optional(
        z.object({
            id: z.optional(idQuerySchema),
            username: z.optional(textQuerySchema),
        })
    ),
    lookups: z.optional(
        z.object({
            every: z.optional(lookupTimestampQuerySchema),
            some: z.optional(lookupTimestampQuerySchema),
            none: z.optional(lookupTimestampQuerySchema),
        })
    ),
}

const whereQuery = z.object({
    OR: z.optional(z.array(z.object(whereQueryFields))),
    ...whereQueryFields,
})

const sortQuery = z.object(
    getSortSchema([
        'id',
        'short',
        'long',
        'expiresAt',
        'lastLookup',
        'count',
    ]) as {
        [key: string]: z.ZodOptional<z.ZodEnum<['asc', 'desc']>>
    }
)

export const linksQuerySchema = z.object({
    where: z.optional(whereQuery),
    sort: z.optional(sortQuery),
    page: z.optional(pageQuerySchema),
    limit: z.optional(limitQuerySchema),
    include: z.optional(
        z.object({
            user: z.optional(z.preprocess((v) => v === 'true', z.boolean())),
            lookups: z.optional(z.preprocess((v) => v === 'true', z.boolean())),
        })
    ),
})

export const linkResponeSchemaFields = z.object({
    id: z.string(),
    short: z.string(),
    long: z.string().url(),
    userId: z.string().uuid(),
    expiresAt: z.date(),
    user: z.optional(
        z.object({
            username: z.optional(z.string().uuid()),
        })
    ),
    count: z.number(),
    lookups: z.optional(
        z.object({
            timestamp: z.optional(z.date()),
        })
    ),
})

export const linkResponeSchema = z.object({
    link: linkResponeSchemaFields,
})

export const paginatedLinksResponseSchema = z.object({
    docs: z.array(linkResponeSchemaFields),
    pagination: PaginationSchema,
})
