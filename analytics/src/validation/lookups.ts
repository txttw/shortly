import { getSortSchema } from 'shortly-shared'
import { z } from 'zod'
import 'zod-openapi/extend'
import {
    dateQuerySchema,
    idQuerySchema,
    limitQuerySchema,
    pageQuerySchema,
    PaginationSchema,
} from './common'

const sortQuery = z.object(
    getSortSchema(['id', 'linkId', 'timestamp']) as {
        [key: string]: z.ZodOptional<z.ZodEnum<['asc', 'desc']>>
    }
)

export const lookupsParamLinkIdSchema = z.object({
    linkId: z.string().uuid(),
})

export const lookupsQuerySchema = z.object({
    where: z.optional(
        z.object({
            timestamp: z.optional(dateQuerySchema),
        })
    ),
    sort: z.optional(sortQuery),
    page: z.optional(pageQuerySchema),
    limit: z.optional(limitQuerySchema),
})

export const lookupResponeSchemaFields = z.object({
    id: z.string(),
    timestamp: z.date(),
})

export const paginatedLookupsResponseSchema = z.object({
    docs: z.array(lookupResponeSchemaFields),
    pagination: PaginationSchema,
})
