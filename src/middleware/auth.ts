import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import type { KVStore } from '../services/kv-store'

const hashPassword = async (pw: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(pw)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class AdminAuth {
  constructor(
    private store: KVStore,
    private jwtSecret: string,
    private defaultPassword: string
  ) {}

  async loginHandler(c: Context): Promise<Response> {
    const { password } = await c.req.json<{ password: string }>()
    const storedHash = await this.store.getAdminPasswordHash()
    const inputHash = await hashPassword(password)

    let valid = false
    if (storedHash) {
      valid = inputHash === storedHash
    } else {
      valid = password === this.defaultPassword
      if (valid) {
        await this.store.setAdminPasswordHash(inputHash)
      }
    }

    if (!valid) {
      return c.json({ error: 'Invalid password' }, 401)
    }

    const token = await sign(
      { role: 'admin', exp: Math.floor(Date.now() / 1000) + 7200 },
      this.jwtSecret
    )

    setCookie(c, 'admin_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 7200,
    })

    return c.json({ ok: true, firstLogin: !storedHash })
  }

  async middleware(c: Context, next: Next): Promise<void> {
    const token = getCookie(c, 'admin_token')
    if (!token) {
      c.status(401)
      c.header('Content-Type', 'application/json')
      c.res = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      return
    }

    try {
      const payload = await verify(token, this.jwtSecret, 'HS256')
      c.set('jwtPayload', payload)
      await next()
    } catch {
      c.status(401)
      c.header('Content-Type', 'application/json')
      c.res = new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
      return
    }
  }

  async changePassword(c: Context): Promise<Response> {
    const { oldPassword, newPassword } = await c.req.json<{ oldPassword: string; newPassword: string }>()
    const storedHash = await this.store.getAdminPasswordHash()
    const oldHash = await hashPassword(oldPassword)

    if (storedHash && oldHash !== storedHash) {
      return c.json({ error: 'Invalid old password' }, 400)
    }

    const newHash = await hashPassword(newPassword)
    await this.store.setAdminPasswordHash(newHash)

    deleteCookie(c, 'admin_token', { path: '/' })

    return c.json({ ok: true })
  }
}
