import type { JwtVariables } from 'hono/jwt'

export interface UpstreamKeyStore {
  fullKey: string
  mask: string
  balance: number | null
  balanceUpdated: number
}

export interface UserKeyStore {
  fullKey: string
  mask: string
  enabled: boolean
}

export type Variables = JwtVariables & {
  jwtPayload: {
    role: string
    exp: number
  }
}
