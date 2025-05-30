import { z } from 'zod'
import 'zod-openapi/extend'

export const directionSchema = z.enum(['asc', 'desc']).optional()
export const directionSchemaWithNull = z.optional(
    z.object({
        sort: z.enum(['asc', 'desc']),
        nulls: z.enum(['last', 'first']),
    })
)

export const getSortSchema = (fields: string[]) => {
    return fields.reduce((prev, field) => {
        prev[field] = z.union([directionSchema, directionSchemaWithNull])
        return prev
    }, {} as { [key: string]: unknown })
}
