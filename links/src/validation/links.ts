import { appDefaults, getSortSchema } from 'shortly-shared'
import { RefinementCtx, z } from 'zod'
import 'zod-openapi/extend'
import {
    dateQuerySchema,
    idQuerySchema,
    limitQuerySchema,
    pageQuerySchema,
    PaginationSchema,
    textQuerySchema,
} from './common'

// Create links
const expires_at_validator = z
    .string()
    .datetime()
    .superRefine((val: string, ctx: RefinementCtx) => {
        if (new Date(val).getTime() <= new Date().getTime()) {
            ctx.addIssue({
                code: z.ZodIssueCode.invalid_date,
                message: 'Date must be in the future',
            })
        }
    })

export const createLinkSchema = z.object({
    long: z.string().url(),
    short: z.optional(z.string().length(appDefaults.shortLength)),
    expiresAt: z.optional(expires_at_validator),
})

// Update Links

export const updateLinkSchema = z
    .object({
        long: z.optional(z.string().url()),
        short: z.optional(z.string()),
        expiresAt: z.optional(expires_at_validator),
    })
    .refine(
        ({ long, expiresAt }) => long !== undefined || expiresAt !== undefined,
        { message: 'One of the fields must be defined [long, expiresAt]' }
    )
    .refine(({ short }) => short === undefined, {
        message: "'short': short link can not be changed",
    })

export const paramLinkIdSchema = z.object({
    id: z.string().uuid(),
})

// Delete Links bulk
export const bulkDeleteParamSchema = z.object({
    ids: z.array(z.string().uuid()),
})

export const bulkDeletedResponseSchema = z.object({
    deleted: z.array(z.string().uuid()).min(1),
})

// Query Links
export const whereQueryFields = {
    id: z.optional(idQuerySchema),
    short: z.optional(textQuerySchema),
    long: z.optional(textQuerySchema),
    expiresAt: z.optional(dateQuerySchema),
    createdAt: z.optional(dateQuerySchema),
    user: z.optional(
        z.object({
            id: z.optional(idQuerySchema),
            username: z.optional(textQuerySchema),
        })
    ),
}

export const whereQuery = z.object({
    OR: z.optional(z.array(z.object(whereQueryFields))),
    ...whereQueryFields,
})

export const sortQuery = z.object(
    getSortSchema(['id', 'short', 'long', 'expiresAt', 'createdAt']) as {
        [key: string]: z.ZodOptional<z.ZodEnum<['asc', 'desc']>>
    }
)

export const listQuerySchema = z.object({
    where: z.optional(whereQuery),
    sort: z.optional(sortQuery),
    page: z.optional(pageQuerySchema),
    limit: z.optional(limitQuerySchema),
    include: z.optional(
        z.object({
            user: z.optional(z.preprocess((v) => v === 'true', z.boolean())),
        })
    ),
})

export const linkResponeSchemaFields = z.object({
    id: z.string(),
    short: z.string(),
    long: z.string().url(),
    userId: z.string().uuid(),
    expiresAt: z.date(),
    createdAt: z.date(),
    deletedAt: z.date().optional(),
    user: z.optional(
        z.object({
            username: z.optional(z.string().uuid()),
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
