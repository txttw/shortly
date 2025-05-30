import { appDefaults } from 'shortly-shared'
import { z } from 'zod'
import 'zod-openapi/extend'

export const apiKeyUserIdSchema = z.object({
    id: z.string().uuid(),
})

export const APIKeyResponseSchema = z.object({
    apiKey: z.string(),
})

export const APIKeySchema = z.object({
    apiKey: z.string(),
})

export const userCredentialsSchema = z.object({
    username: z.string().min(appDefaults.auth.usernameMinLength),
    password: z.string().min(appDefaults.auth.pwMinLength),
})

export const refreshTokenSchema = z.object({
    refresh: z.string(),
})

export const JWTResponseSchema = z.object({
    token: z.string(),
    refresh: z.string().optional(),
})

export const APIKeyCountResponseSchema = z.object({
    count: z.number(),
})
