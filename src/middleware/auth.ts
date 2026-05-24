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
      return c.json({ error: '密码错误' }, 401)
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

  async verifyToken(c: Context): Promise<boolean> {
    const token = getCookie(c, 'admin_token')
    if (!token) return false
    try {
      const payload = await verify(token, this.jwtSecret, 'HS256')
      c.set('jwtPayload', payload)
      return true
    } catch {
      return false
    }
  }

  async middleware(c: Context, next: Next): Promise<void> {
    const token = getCookie(c, 'admin_token')
    if (!token) {
      c.res = c.json({ error: '未登录' }, 401)
      return
    }
    try {
      const payload = await verify(token, this.jwtSecret, 'HS256')
      c.set('jwtPayload', payload)
      await next()
    } catch {
      c.res = c.json({ error: 'Token 无效或已过期' }, 401)
      return
    }
  }

  async changePassword(c: Context): Promise<Response> {
    const { oldPassword, newPassword } = await c.req.json<{ oldPassword: string; newPassword: string }>()
    const storedHash = await this.store.getAdminPasswordHash()
    const oldHash = await hashPassword(oldPassword)

    if (storedHash && oldHash !== storedHash) {
      return c.json({ error: '当前密码错误' }, 400)
    }

    const newHash = await hashPassword(newPassword)
    await this.store.setAdminPasswordHash(newHash)

    deleteCookie(c, 'admin_token', { path: '/' })

    return c.json({ ok: true })
  }
}
