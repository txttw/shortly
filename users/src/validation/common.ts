import { z } from 'zod'
import 'zod-openapi/extend'

export const idQuerySchema = z.string().min(1)

export const textQuerySchema = z.object({
    equals: z.string().min(1).optional(),
    contains: z.string().min(1).optional(),
    not: z.string().min(1).optional(),
    in: z.array(z.string().min(1)).min(1).optional(),
    notIn: z.array(z.string().min(1)).min(1).optional(),
})

export const arrayQuerySchema = z.object({
    array_contains: z.array(z.string().min(1)).min(1).optional(),
})

export const dateQuerySchema = z.object({
    lt: z.string().datetime().optional(),
    gt: z.string().datetime().optional(),
})

export const positiveIntQuerySchema = z.preprocess(
    (v) => parseInt(v as string),
    z.number()
)

export const uIntRange = z.object({
    lte: z.optional(positiveIntQuerySchema),
    gte: z.optional(positiveIntQuerySchema),
})

export const pageQuerySchema = z.preprocess(
    (v) => parseInt(v as string),
    z.number().min(1)
)

export const limitQuerySchema = z.preprocess(
    (v) => parseInt(v as string),
    z.number().min(1).max(100)
)

export const PaginationSchema = z.object({
    page: z.number().min(1),
    limit: z.number().min(1),
    hasNextPage: z.boolean(),
    prev: z.union([z.number().min(1), z.null()]),
    next: z.union([z.number().min(2), z.null()]),
})
