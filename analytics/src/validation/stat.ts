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
import { linkResponeSchemaFields } from './links'

export const linksStatQuerySchema = z.optional(
    z.object({
        statPeriod: z.optional(dateQuerySchema),
    })
)

export const lookupStatQuerySchema = z.optional(
    z.object({
        statPeriod: z.optional(dateQuerySchema),
        groupBy: z.optional(
            z.enum(['year', 'quarter', 'month', 'week', 'day', 'hour'])
        ),
    })
)

export const linksStatResponeSchema = z.object({
    stats: z.object({
        links: z.number(),
        lookups: z.number(),
    }),
})

const lookupGrouppedResponseSchema = z.array(
    z.object({
        group: z.union([z.string(), z.number()]),
        count: z.number(),
    })
)

export const lookupsStatResponeSchema = z.object({
    link: linkResponeSchemaFields,
    stats: z.object({
        lookups: z.union([lookupGrouppedResponseSchema, z.number()]),
    }),
})
