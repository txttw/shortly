import {
    JwtTokenInvalidExpired,
    JwtTokenInvalidFormat,
    JwtTokenInvalidSignature,
} from './errors'
import { base64Decode } from './utils'

export async function hashPassword(
    password: string,
    providedSalt?: Uint8Array
): Promise<string> {
    const encoder = new TextEncoder()
    // Use provided salt if available, otherwise generate a new one
    const salt = providedSalt || crypto.getRandomValues(new Uint8Array(16))
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    )
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )
    const exportedKey = (await crypto.subtle.exportKey(
        'raw',
        key
    )) as ArrayBuffer
    const hashBuffer = new Uint8Array(exportedKey)
    const hashArray = Array.from(hashBuffer)
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    const saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return `${saltHex}:${hashHex}`
}

export async function verifyPassword(
    storedHash: string,
    passwordAttempt: string
): Promise<boolean> {
    const [saltHex, originalHash] = storedHash.split(':')
    const matchResult = saltHex.match(/.{1,2}/g)
    if (!matchResult) {
        throw new Error('Invalid salt format')
    }
    const salt = new Uint8Array(matchResult.map((byte) => parseInt(byte, 16)))
    const attemptHashWithSalt = await hashPassword(passwordAttempt, salt)
    const [, attemptHash] = attemptHashWithSalt.split(':')
    return attemptHash === originalHash
}

export async function sign(key: string, data: string): Promise<string> {
    let enc = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        Buffer.from(key, 'base64'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const signature: ArrayBuffer = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        enc.encode(data)
    )
    const signatureHex = [...new Uint8Array(signature)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return signatureHex
}

// This is for services without a framework
export async function verifyJWT(
    key: string,
    token: string
): Promise<{ [key: string]: unknown }> {
    let enc = new TextEncoder()

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    )
    const parts = token.split('.')

    if (parts.length !== 3) {
        throw new JwtTokenInvalidFormat()
    }

    const [header, payload, signature] = parts

    const decodedHeader = JSON.parse(base64Decode(header))
    if (decodedHeader.alg !== 'HS256' && decodedHeader.typ !== 'JWT') {
        throw new JwtTokenInvalidFormat()
    }

    const now = Date.now() / 1e3
    const decodedPayload = JSON.parse(base64Decode(payload))
    if (decodedPayload.exp && decodedPayload.exp <= now) {
        throw new JwtTokenInvalidExpired()
    }

    const signatureValid = await crypto.subtle.verify(
        'HMAC',
        cryptoKey,
        Buffer.from(signature, 'base64'),
        enc.encode(parts.slice(0, 2).join('.'))
    )

    if (!signatureValid) {
        throw new JwtTokenInvalidSignature()
    }

    return decodedPayload
}
