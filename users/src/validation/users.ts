import { appDefaults, getSortSchema, Permissions } from 'shortly-shared'
import { z } from 'zod'
import 'zod-openapi/extend'
import {
    arrayQuerySchema,
    dateQuerySchema,
    idQuerySchema,
    limitQuerySchema,
    pageQuerySchema,
    PaginationSchema,
    textQuerySchema,
} from './common'

// Create User
export const createUserSchema = z.object({
    username: z
        .string()
        .min(appDefaults.auth.usernameMinLength)
        .max(30)
        .openapi({ example: 'john' }),
    permissions: z.optional(z.array(z.nativeEnum(Permissions))),
    password: z.string().min(appDefaults.auth.pwMinLength),
})

// Update User
export const updateUserSchema = z
    .object({
        username: z
            .optional(z.string().min(2).max(25))
            .openapi({ example: 'john' }),
        permissions: z.optional(z.array(z.nativeEnum(Permissions))),
        password: z.optional(z.string().min(appDefaults.auth.pwMinLength)),
    })
    .refine(
        ({ username, permissions }) =>
            username !== undefined || permissions !== undefined,
        { message: 'One of the fields must be defined' }
    )

export const paramUserIdSchema = z.object({
    id: z.string().uuid(),
})

// Delete Links bulk
export const bulkDeleteParamSchema = z.object({
    ids: z.array(z.string().uuid()),
})

export const bulkDeletedResponseSchema = z.object({
    deleted: z.array(z.string().uuid()).min(1),
})

export const whereQuery = z.object({
    id: z.optional(idQuerySchema),
    username: z.optional(textQuerySchema),
    scopes: z.optional(arrayQuerySchema),
    createdAt: z.optional(dateQuerySchema),
})

export const sortQuery = z.object(
    getSortSchema(['id', 'username', 'createdAt']) as {
        [key: string]: z.ZodOptional<z.ZodEnum<['asc', 'desc']>>
    }
)

export const listQuerySchema = z.object({
    where: z.optional(whereQuery),
    sort: z.optional(sortQuery),
    page: z.optional(pageQuerySchema),
    limit: z.optional(limitQuerySchema),
})

export const userResponeSchemaFields = z.object({
    id: z.string(),
    username: z.string(),
    createdAt: z.date(),
    deletedAt: z.date().optional(),
})

export const userResponeSchema = z.object({
    user: userResponeSchemaFields,
})

export const paginatedLinksResponseSchema = z.object({
    docs: z.array(userResponeSchemaFields),
    pagination: PaginationSchema,
})
