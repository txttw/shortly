import { verifyJWT } from './crypto'
import { appConstants } from './defaults'
import { JwtInvalidHeader } from './errors'
import { Permissions } from './permissions'
import { base64Decode } from './utils'

export type AuthorizationResult =
    | {
          id: string
          permissions: Array<Permissions>
      }
    | undefined

export async function authJWT(signKeyBase64: string, authHeader?: string) {
    if (authHeader) {
        if (authHeader.startsWith(appConstants.auth.JWTPrefix)) {
            const token = authHeader
                .replace(appConstants.auth.JWTPrefix, '')
                .trim()

            const payload = await verifyJWT(base64Decode(signKeyBase64), token)
            return {
                id: payload.sub as string,
                permissions: payload.perm as Array<Permissions>,
            }
        }
    }
    throw new JwtInvalidHeader()
}
