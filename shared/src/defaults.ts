// These options are user facing
export const appDefaults = {
    shortLength: 6,
    expiresInDays: 7,
    auth: {
        pwMinLength: 8,
    },
}

// These options related to the app operation
export const appConstants = {
    auth: {
        ApiKeyPrefix: 'APIKey',
        JWTPrefix: 'Bearer',
        JWTExpires: 10 * 60, // 10 minutes in s
        JWTRefreshExpires: 24 * 60 * 60, // 24 hours in s
        ApiKeyCachTtl: 300, // 5 minutes
        refreshFingerprintCookieName: '__Secure-refresh_fp',
    },
}
