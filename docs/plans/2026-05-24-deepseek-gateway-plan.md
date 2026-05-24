# DeepSeek API Gateway — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare Worker that proxies requests to DeepSeek API through a pool of upstream keys with key affinity, plus an admin page for key management and balance monitoring.

**Architecture:** Hono framework on Cloudflare Workers, KV for state, JSX for admin UI. Consistent hashing maps user keys to upstream DeepSeek keys. All `/v1/*` requests forwarded transparently including SSE streams.

**Tech Stack:** Hono, Cloudflare Workers, Cloudflare KV, JSX, TypeScript

---

## Setup: Project Scaffolding

**Step 1: Initialize the Hono project**

Run: `npm create hono@latest .` (in existing directory, choose cloudflare-workers template)

**Step 2: Install dependencies**

```bash
npm install hono
```

**Step 3: Configure tsconfig.json for JSX**

Ensure tsconfig.json has:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

**Step 4: Configure wrangler.toml**

```toml
name = "deepseek-gateway"
main = "src/index.tsx"
compatibility_date = "2025-01-01"
minify = true

[[kv_namespaces]]
binding = "AIGATEWAY"
id = "your-kv-id"
preview_id = "your-preview-kv-id"

[vars]
ADMIN_DEFAULT_PASSWORD = "admin123"
JWT_SECRET = "change-me-in-production"
SALT = "gateway-salt-2026"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Hono Cloudflare Worker project"
```

---

### Task 1: Types Definition

**Files:**
- Create: `src/types.ts`

**Step 1: Write types**

```typescript
// src/types.ts
import type { JwtVariables } from 'hono/jwt'

export interface UpstreamKey {
  id: string
  fullKey: string        // "sk-xxxxxxxxxxxxxxxx"
  mask: string           // "sk-xxxx...xxxx"
  balance: number | null
  balanceUpdated: number // timestamp
}

export interface UserKey {
  id: string
  mask: string           // "ak-xxxx...xxxx"
  enabled: boolean
}

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
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add type definitions"
```

---

### Task 2: KV Storage Service

**Files:**
- Create: `src/services/kv-store.ts`

**Purpose:** Read/write upstream keys, user keys, and admin password from KV.

**Step 1: Write the KV store service**

```typescript
// src/services/kv-store.ts
import type { UpstreamKeyStore, UserKeyStore } from '../types'

export class KVStore {
  constructor(private kv: KVNamespace) {}

  // --- Admin Password ---

  async getAdminPasswordHash(): Promise<string | null> {
    return this.kv.get('admin:password')
  }

  async setAdminPasswordHash(hash: string): Promise<void> {
    await this.kv.put('admin:password', hash)
  }

  // --- Upstream Keys ---

  async getUpstreamKeyIds(): Promise<string[]> {
    const raw = await this.kv.get('upstream:keys')
    return raw ? JSON.parse(raw) : []
  }

  async setUpstreamKeyIds(ids: string[]): Promise<void> {
    await this.kv.put('upstream:keys', JSON.stringify(ids))
  }

  async getUpstreamKey(id: string): Promise<UpstreamKeyStore | null> {
    const raw = await this.kv.get(`upstream:key:${id}`)
    return raw ? JSON.parse(raw) : null
  }

  async setUpstreamKey(id: string, data: UpstreamKeyStore): Promise<void> {
    await this.kv.put(`upstream:key:${id}`, JSON.stringify(data))
  }

  async deleteUpstreamKey(id: string): Promise<void> {
    await this.kv.delete(`upstream:key:${id}`)
  }

  // --- User Keys ---

  async getUserKeyIds(): Promise<string[]> {
    const raw = await this.kv.get('user:keys')
    return raw ? JSON.parse(raw) : []
  }

  async setUserKeyIds(ids: string[]): Promise<void> {
    await this.kv.put('user:keys', JSON.stringify(ids))
  }

  async getUserKey(id: string): Promise<UserKeyStore | null> {
    const raw = await this.kv.get(`user:key:${id}`)
    return raw ? JSON.parse(raw) : null
  }

  async setUserKey(id: string, data: UserKeyStore): Promise<void> {
    await this.kv.put(`user:key:${id}`, JSON.stringify(data))
  }

  async deleteUserKey(id: string): Promise<void> {
    await this.kv.delete(`user:key:${id}`)
  }
}
```

**Step 2: Commit**

```bash
git add src/services/kv-store.ts
git commit -m "feat: add KV storage service"
```

---

### Task 3: Key Pool with Consistent Hashing

**Files:**
- Create: `src/services/key-pool.ts`

**Purpose:** Select an upstream key based on user key via consistent hashing. Simple FNV-1a hash for stable mapping.

**Step 1: Write the key pool service**

```typescript
// src/services/key-pool.ts
import type { KVStore } from './kv-store'

function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return hash >>> 0
}

export class KeyPool {
  constructor(
    private store: KVStore,
    private salt: string
  ) {}

  async getUpstreamKey(userKey: string): Promise<{ id: string; fullKey: string } | null> {
    const ids = await this.store.getUpstreamKeyIds()
    if (ids.length === 0) return null

    const hash = fnv1a(userKey + this.salt)
    const idx = hash % ids.length
    const id = ids[idx]

    const keyData = await this.store.getUpstreamKey(id)
    if (!keyData) return null

    return { id, fullKey: keyData.fullKey }
  }
}
```

**Step 2: Commit**

```bash
git add src/services/key-pool.ts
git commit -m "feat: add consistent hashing key pool"
```

---

### Task 4: Balance Check Service

**Files:**
- Create: `src/services/balance.ts`

**Purpose:** Query DeepSeek API for account balance and update KV cache.

**Step 1: Write balance service**

```typescript
// src/services/balance.ts
import type { KVStore } from './kv-store'

export class BalanceService {
  constructor(
    private store: KVStore,
    private baseUrl: string
  ) {}

  async refreshBalance(keyId: string): Promise<number | null> {
    const keyData = await this.store.getUpstreamKey(keyId)
    if (!keyData) return null

    try {
      const res = await fetch(`${this.baseUrl}/user/balance`, {
        headers: { Authorization: `Bearer ${keyData.fullKey}` },
      })
      if (!res.ok) return null

      const json = await res.json() as { balance_infos?: Array<{ total_balance?: string }> }
      const balance = parseFloat(json.balance_infos?.[0]?.total_balance || '0')

      keyData.balance = balance
      keyData.balanceUpdated = Date.now()
      await this.store.setUpstreamKey(keyId, keyData)

      return balance
    } catch {
      return null
    }
  }

  async refreshAllBalances(): Promise<Map<string, number | null>> {
    const ids = await this.store.getUpstreamKeyIds()
    const results = new Map<string, number | null>()

    for (const id of ids) {
      results.set(id, await this.refreshBalance(id))
    }

    return results
  }
}
```

**Step 2: Commit**

```bash
git add src/services/balance.ts
git commit -m "feat: add balance check service"
```

---

### Task 5: Admin Auth Middleware

**Files:**
- Create: `src/middleware/auth.ts`

**Purpose:** JWT cookie-based authentication for admin routes. Login endpoint issues JWT. Middleware validates JWT from cookie.

**Step 1: Write the auth middleware and login handler**

```typescript
// src/middleware/auth.ts
import { sign, verify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import type { KVStore } from '../services/kv-store'

const hashPassword = async (pw: string): Promise<string> => {
  const encoder = new TextEncoder()
  const data = encoder.encode(pw)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
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
      // First login: use default password
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
      return c.json({ error: 'Unauthorized' })
    }

    try {
      const payload = await verify(token, this.jwtSecret)
      c.set('jwtPayload', payload)
      await next()
    } catch {
      c.status(401)
      return c.json({ error: 'Invalid token' })
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

    // Logout after password change
    deleteCookie(c, 'admin_token', { path: '/' })

    return c.json({ ok: true })
  }
}
```

**Step 2: Commit**

```bash
git add src/middleware/auth.ts
git commit -m "feat: add admin JWT auth middleware"
```

---

### Task 6: Proxy Route (API Forwarding + SSE)

**Files:**
- Create: `src/routes/proxy.ts`

**Purpose:** Handle all `/v1/*` requests — authenticate user key, select upstream key via consistent hashing, forward request to DeepSeek, passthrough response (including SSE streaming).

**Step 1: Write proxy route**

```typescript
// src/routes/proxy.ts
import { Hono } from 'hono'
import type { KVStore } from '../services/kv-store'
import type { KeyPool } from '../services/key-pool'

export function createProxyRoute(store: KVStore, keyPool: KeyPool, deepseekBaseUrl: string): Hono {
  const app = new Hono()

  app.all('/v1/*', async (c) => {
    // 1. Authenticate user key
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401)
    }

    const userKeyValue = authHeader.slice(7)
    const userKeyIds = await store.getUserKeyIds()

    // Find the user key by trying each stored ID
    let userKeyId: string | null = null
    let userKeyEnabled = false

    for (const id of userKeyIds) {
      const key = await store.getUserKey(id)
      if (key && key.fullKey === userKeyValue) {
        userKeyId = id
        userKeyEnabled = key.enabled
        break
      }
    }

    if (!userKeyId) {
      return c.json({ error: 'Invalid API key' }, 401)
    }
    if (!userKeyEnabled) {
      return c.json({ error: 'API key is disabled' }, 403)
    }

    // 2. Select upstream key
    const upstream = await keyPool.getUpstreamKey(userKeyValue)
    if (!upstream) {
      return c.json({ error: 'No upstream keys configured' }, 503)
    }

    // 3. Forward request
    const url = `${deepseekBaseUrl}${c.req.path}`
    const headers = new Headers(c.req.raw.headers)
    headers.set('Authorization', `Bearer ${upstream.fullKey}`)
    headers.delete('Host')

    const body = c.req.raw.body

    const proxyRes = await fetch(url, {
      method: c.req.method,
      headers,
      body,
    })

    // 4. Passthrough response (including SSE streaming)
    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: proxyRes.headers,
    })
  })

  return app
}
```

**Step 2: Commit**

```bash
git add src/routes/proxy.ts
git commit -m "feat: add proxy route with SSE passthrough"
```

---

### Task 7: Admin API Routes

**Files:**
- Create: `src/routes/admin-api.ts`

**Purpose:** REST API for managing upstream keys, user keys, balance, and password.

**Step 1: Write admin API routes**

```typescript
// src/routes/admin-api.ts
import { Hono } from 'hono'
import type { KVStore } from '../services/kv-store'
import type { BalanceService } from '../services/balance'
import type { AdminAuth } from '../middleware/auth'

function generateId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 3) + '...'
  return key.slice(0, 6) + '...' + key.slice(-4)
}

export function createAdminApiRoutes(
  store: KVStore,
  balanceService: BalanceService,
  auth: AdminAuth
): Hono {
  const app = new Hono()

  // All routes require auth
  app.use('*', (c, next) => auth.middleware(c, next))

  app.post('/login', (c) => auth.loginHandler(c))

  // --- Upstream Keys ---

  app.get('/keys', async (c) => {
    const ids = await store.getUpstreamKeyIds()
    const keys = await Promise.all(
      ids.map(async (id) => {
        const data = await store.getUpstreamKey(id)
        return {
          id,
          mask: data?.mask ?? maskKey(id),
          balance: data?.balance ?? null,
          balanceUpdated: data?.balanceUpdated ?? 0,
        }
      })
    )
    return c.json(keys)
  })

  app.post('/keys', async (c) => {
    const { key } = await c.req.json<{ key: string }>()
    if (!key) return c.json({ error: 'Key is required' }, 400)

    const id = generateId()
    await store.setUpstreamKey(id, {
      fullKey: key,
      mask: maskKey(key),
      balance: null,
      balanceUpdated: 0,
    })

    const ids = await store.getUpstreamKeyIds()
    ids.push(id)
    await store.setUpstreamKeyIds(ids)

    return c.json({ id, mask: maskKey(key) }, 201)
  })

  app.delete('/keys/:id', async (c) => {
    const { id } = c.req.param()
    const ids = await store.getUpstreamKeyIds()
    const filtered = ids.filter((i) => i !== id)

    if (filtered.length === ids.length) {
      return c.json({ error: 'Key not found' }, 404)
    }

    await store.setUpstreamKeyIds(filtered)
    await store.deleteUpstreamKey(id)

    return c.json({ ok: true })
  })

  app.post('/keys/refresh-balance', async (c) => {
    const results = await balanceService.refreshAllBalances()
    const data = Object.fromEntries(results)
    return c.json(data)
  })

  // --- User Keys ---

  app.get('/user-keys', async (c) => {
    const ids = await store.getUserKeyIds()
    const keys = await Promise.all(
      ids.map(async (id) => {
        const data = await store.getUserKey(id)
        return {
          id,
          mask: data?.mask ?? maskKey(id),
          enabled: data?.enabled ?? true,
        }
      })
    )
    return c.json(keys)
  })

  app.post('/user-keys', async (c) => {
    const { key } = await c.req.json<{ key: string }>()
    if (!key) return c.json({ error: 'Key is required' }, 400)

    const id = generateId()
    await store.setUserKey(id, {
      fullKey: key,
      mask: maskKey(key),
      enabled: true,
    })

    const ids = await store.getUserKeyIds()
    ids.push(id)
    await store.setUserKeyIds(ids)

    // Return the full key only on creation (one-time visibility)
    return c.json({ id, key, mask: maskKey(key) }, 201)
  })

  app.delete('/user-keys/:id', async (c) => {
    const { id } = c.req.param()
    const ids = await store.getUserKeyIds()
    const filtered = ids.filter((i) => i !== id)

    if (filtered.length === ids.length) {
      return c.json({ error: 'Key not found' }, 404)
    }

    await store.setUserKeyIds(filtered)
    await store.deleteUserKey(id)

    return c.json({ ok: true })
  })

  app.put('/user-keys/:id/toggle', async (c) => {
    const { id } = c.req.param()
    const keyData = await store.getUserKey(id)
    if (!keyData) return c.json({ error: 'Key not found' }, 404)

    keyData.enabled = !keyData.enabled
    await store.setUserKey(id, keyData)

    return c.json({ id, enabled: keyData.enabled })
  })

  // --- Password ---

  app.put('/password', (c) => auth.changePassword(c))

  return app
}
```

**Step 2: Commit**

```bash
git add src/routes/admin-api.ts
git commit -m "feat: add admin API routes"
```

---

### Task 8: Admin Page View (JSX)

**Files:**
- Create: `src/views/admin.tsx`

**Purpose:** Server-rendered admin page with two sections: Upstream Keys (with balance) and User Keys (with enable/disable).

**Step 1: Write admin page JSX**

```typescript
// src/views/admin.tsx
import type { FC } from 'hono/jsx'

interface KeyInfo {
  id: string
  mask: string
  balance?: number | null
  enabled?: boolean
}

export const AdminPage: FC<{
  upstreamKeys: KeyInfo[]
  userKeys: KeyInfo[]
}> = ({ upstreamKeys, userKeys }) => (
  <html>
    <head>
      <title>DeepSeek Gateway - Admin</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; max-width: 960px; margin: 0 auto; padding: 24px; }
        h1 { font-size: 24px; margin-bottom: 24px; }
        h2 { font-size: 18px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #334155; }
        .card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #334155; }
        th { color: #94a3b8; font-weight: 500; font-size: 13px; text-transform: uppercase; }
        button { border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; font-weight: 500; }
        .btn-primary { background: #3b82f6; color: #fff; }
        .btn-primary:hover { background: #2563eb; }
        .btn-danger { background: #ef4444; color: #fff; }
        .btn-danger:hover { background: #dc2626; }
        .btn-sm { padding: 4px 10px; font-size: 12px; }
        input[type="text"], input[type="password"] { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 12px; color: #e2e8f0; width: 100%; max-width: 400px; font-size: 14px; }
        input:focus { outline: none; border-color: #3b82f6; }
        .flex { display: flex; gap: 8px; align-items: center; }
        .mb-4 { margin-bottom: 16px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
        .badge-on { background: #166534; color: #4ade80; }
        .badge-off { background: #991b1b; color: #f87171; }
        .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .status { color: #94a3b8; font-size: 13px; }
      `}</style>
    </head>
    <body>
      <div class="topbar">
        <h1>DeepSeek API Gateway</h1>
        <span class="status">Admin</span>
      </div>

      <div class="card">
        <h2>Upstream Keys (DeepSeek)</h2>
        <table>
          <thead>
            <tr><th>Key</th><th>Balance</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {upstreamKeys.map((k) => (
              <tr>
                <td><code>{k.mask}</code></td>
                <td>{k.balance != null ? `¥${k.balance.toFixed(2)}` : '—'}</td>
                <td>
                  <button class="btn-danger btn-sm" hx-delete={`/admin/api/keys/${k.id}`} hx-confirm="Delete this key?">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="flex mb-4" style="margin-top: 12px;">
          <input type="text" id="new-upstream-key" placeholder="sk-xxxxxxxxxxxxxxxx" />
          <button class="btn-primary" onclick="addUpstreamKey()">Add Key</button>
          <button class="btn-primary" onclick="refreshBalances()">Refresh Balances</button>
        </div>
      </div>

      <div class="card">
        <h2>User Keys</h2>
        <table>
          <thead>
            <tr><th>Key</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {userKeys.map((k) => (
              <tr>
                <td><code>{k.mask}</code></td>
                <td>
                  <span class={`badge ${k.enabled ? 'badge-on' : 'badge-off'}`}>
                    {k.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td class="flex">
                  <button class="btn-sm btn-primary" hx-put={`/admin/api/user-keys/${k.id}/toggle`} hx-swap="none">
                    {k.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button class="btn-sm btn-danger" hx-delete={`/admin/api/user-keys/${k.id}`} hx-confirm="Delete this key?">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="flex" style="margin-top: 12px;">
          <input type="text" id="new-user-key" placeholder="Key prefix (e.g., ak-)" />
          <button class="btn-primary" onclick="createUserKey()">Create User Key</button>
        </div>
      </div>

      <div class="card">
        <h2>Change Password</h2>
        <div class="flex mb-4">
          <input type="password" id="old-password" placeholder="Old password" />
          <input type="password" id="new-password" placeholder="New password" />
          <button class="btn-primary" onclick="changePassword()">Change</button>
        </div>
        <div id="password-msg"></div>
      </div>

      <script src="https://unpkg.com/htmx.org@1.9.10"></script>
      <script>{`
        async function api(method, path, body) {
          const res = await fetch('/admin/api' + path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          })
          if (res.status === 401) { location.href = '/admin/login'; return }
          return res.json()
        }

        async function addUpstreamKey() {
          const input = document.getElementById('new-upstream-key')
          const key = input.value.trim()
          if (!key) return alert('Enter a key')
          await api('POST', '/keys', { key })
          location.reload()
        }

        async function refreshBalances() {
          await api('POST', '/keys/refresh-balance')
          location.reload()
        }

        async function createUserKey() {
          const input = document.getElementById('new-user-key')
          const prefix = input.value.trim()
          if (!prefix) return alert('Enter a prefix')
          const key = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
          const result = await api('POST', '/user-keys', { key })
          if (result.key) {
            alert('Created key (copy now — shown only once):\\n\\n' + result.key)
          }
          location.reload()
        }

        async function changePassword() {
          const oldPw = document.getElementById('old-password').value
          const newPw = document.getElementById('new-password').value
          const result = await api('PUT', '/password', { oldPassword: oldPw, newPassword: newPw })
          const msg = document.getElementById('password-msg')
          if (result.ok) {
            msg.innerHTML = '<span style="color:#4ade80">Password changed. Redirecting...</span>'
            setTimeout(() => location.href = '/admin/login', 1500)
          } else {
            msg.innerHTML = '<span style="color:#f87171">' + result.error + '</span>'
          }
        }

        document.body.addEventListener('htmx:afterRequest', (e) => {
          if (e.detail.requestConfig.method !== 'get') location.reload()
        })
      `}</script>
    </body>
  </html>
)

export const LoginPage: FC<{ error?: string }> = ({ error }) => (
  <html>
    <head>
      <title>DeepSeek Gateway - Login</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .login-card { background: #1e293b; border-radius: 8px; padding: 32px; width: 360px; }
        h1 { font-size: 20px; margin-bottom: 20px; text-align: center; }
        input { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px 14px; color: #e2e8f0; width: 100%; font-size: 14px; margin-bottom: 12px; }
        input:focus { outline: none; border-color: #3b82f6; }
        button { width: 100%; border: none; border-radius: 6px; padding: 10px; font-size: 14px; cursor: pointer; background: #3b82f6; color: #fff; font-weight: 500; }
        button:hover { background: #2563eb; }
        .error { color: #f87171; font-size: 13px; margin-bottom: 12px; }
      `}</style>
    </head>
    <body>
      <div class="login-card">
        <h1>Gateway Admin</h1>
        {error && <div class="error">{error}</div>}
        <form method="post" action="/admin/api/login" id="login-form">
          <input type="password" name="password" placeholder="Admin password" autofocus />
          <button type="submit">Login</button>
        </form>
        <script>{`
          document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const password = e.target.password.value
            const res = await fetch('/admin/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password }),
            })
            if (res.ok) {
              location.href = '/admin'
            } else {
              const data = await res.json()
              document.querySelector('.error')?.remove()
              const div = document.createElement('div')
              div.className = 'error'
              div.textContent = data.error
              e.target.insertBefore(div, e.target.firstChild)
            }
          })
        `}</script>
      </div>
    </body>
  </html>
)
```

**Step 2: Commit**

```bash
git add src/views/admin.tsx
git commit -m "feat: add admin page JSX views"
```

---

### Task 9: Main Entry Point

**Files:**
- Create: `src/index.tsx`

**Purpose:** Wire everything together: instantiate services, mount routes.

**Step 1: Write entry point**

```typescript
// src/index.tsx
import { Hono } from 'hono'
import { KVStore } from './services/kv-store'
import { KeyPool } from './services/key-pool'
import { BalanceService } from './services/balance'
import { AdminAuth } from './middleware/auth'
import { createProxyRoute } from './routes/proxy'
import { createAdminApiRoutes } from './routes/admin-api'
import { AdminPage, LoginPage } from './views/admin'
import { getCookie } from 'hono/cookie'

export interface Env {
  AIGATEWAY: KVNamespace
  ADMIN_DEFAULT_PASSWORD: string
  JWT_SECRET: string
  SALT: string
  DEEPSEEK_BASE_URL: string
}

const app = new Hono<{ Bindings: Env }>()

app.get('/admin/login', (c) => {
  return c.html(<LoginPage />)
})

app.get('/admin', async (c) => {
  // Check auth via cookie (simple check, full auth on API)
  const store = new KVStore(c.env.AIGATEWAY)
  const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)

  try {
    await auth.middleware(c, async () => {})
  } catch {
    return c.redirect('/admin/login')
  }

  const upstreamIds = await store.getUpstreamKeyIds()
  const upstreamKeys = await Promise.all(
    upstreamIds.map(async (id) => {
      const data = await store.getUpstreamKey(id)
      return { id, mask: data?.mask ?? id, balance: data?.balance }
    })
  )

  const userKeyIds = await store.getUserKeyIds()
  const userKeys = await Promise.all(
    userKeyIds.map(async (id) => {
      const data = await store.getUserKey(id)
      return { id, mask: data?.mask ?? id, enabled: data?.enabled ?? true }
    })
  )

  return c.html(<AdminPage upstreamKeys={upstreamKeys} userKeys={userKeys} />)
})

// Mount API routes
app.route('/admin/api', (() => {
  const apiApp = new Hono<{ Bindings: Env }>()

  // We need lazy instantiation because we need c.env
  apiApp.use('*', async (c, next) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    const balanceService = new BalanceService(store, c.env.DEEPSEEK_BASE_URL)

    c.set('store' as any, store)
    c.set('auth' as any, auth)
    c.set('balanceService' as any, balanceService)
    await next()
  })

  // Login
  apiApp.post('/login', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    return auth.loginHandler(c)
  })

  // Protected routes
  apiApp.use('/keys', async (c, next) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    return auth.middleware(c, next)
  })
  apiApp.use('/user-keys', async (c, next) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    return auth.middleware(c, next)
  })
  apiApp.use('/password', async (c, next) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    return auth.middleware(c, next)
  })

  apiApp.get('/keys', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const ids = await store.getUpstreamKeyIds()
    const keys = await Promise.all(ids.map(async (id) => {
      const data = await store.getUpstreamKey(id)
      return { id, mask: data?.mask ?? id, balance: data?.balance ?? null, balanceUpdated: data?.balanceUpdated ?? 0 }
    }))
    return c.json(keys)
  })

  apiApp.post('/keys', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const { key } = await c.req.json<{ key: string }>()
    if (!key) return c.json({ error: 'Key is required' }, 400)
    const id = crypto.randomUUID().slice(0, 8)
    const mask = key.length <= 12 ? key.slice(0, 3) + '...' : key.slice(0, 6) + '...' + key.slice(-4)
    await store.setUpstreamKey(id, { fullKey: key, mask, balance: null, balanceUpdated: 0 })
    const ids = await store.getUpstreamKeyIds()
    ids.push(id)
    await store.setUpstreamKeyIds(ids)
    return c.json({ id, mask }, 201)
  })

  apiApp.delete('/keys/:id', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const { id } = c.req.param()
    const ids = await store.getUpstreamKeyIds()
    const filtered = ids.filter((i) => i !== id)
    if (filtered.length === ids.length) return c.json({ error: 'Not found' }, 404)
    await store.setUpstreamKeyIds(filtered)
    await store.deleteUpstreamKey(id)
    return c.json({ ok: true })
  })

  apiApp.post('/keys/refresh-balance', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const balanceService = new BalanceService(store, c.env.DEEPSEEK_BASE_URL)
    const results = await balanceService.refreshAllBalances()
    return c.json(Object.fromEntries(results))
  })

  apiApp.get('/user-keys', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const ids = await store.getUserKeyIds()
    const keys = await Promise.all(ids.map(async (id) => {
      const data = await store.getUserKey(id)
      return { id, mask: data?.mask ?? id, enabled: data?.enabled ?? true }
    }))
    return c.json(keys)
  })

  apiApp.post('/user-keys', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const { key } = await c.req.json<{ key: string }>()
    if (!key) return c.json({ error: 'Key is required' }, 400)
    const id = crypto.randomUUID().slice(0, 8)
    const mask = key.length <= 12 ? key.slice(0, 3) + '...' : key.slice(0, 6) + '...' + key.slice(-4)
    await store.setUserKey(id, { fullKey: key, mask, enabled: true })
    const ids = await store.getUserKeyIds()
    ids.push(id)
    await store.setUserKeyIds(ids)
    return c.json({ id, key, mask }, 201)
  })

  apiApp.delete('/user-keys/:id', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const { id } = c.req.param()
    const ids = await store.getUserKeyIds()
    const filtered = ids.filter((i) => i !== id)
    if (filtered.length === ids.length) return c.json({ error: 'Not found' }, 404)
    await store.setUserKeyIds(filtered)
    await store.deleteUserKey(id)
    return c.json({ ok: true })
  })

  apiApp.put('/user-keys/:id/toggle', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const { id } = c.req.param()
    const keyData = await store.getUserKey(id)
    if (!keyData) return c.json({ error: 'Not found' }, 404)
    keyData.enabled = !keyData.enabled
    await store.setUserKey(id, keyData)
    return c.json({ id, enabled: keyData.enabled })
  })

  apiApp.put('/password', async (c) => {
    const store = new KVStore(c.env.AIGATEWAY)
    const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
    return auth.changePassword(c)
  })

  return apiApp
})())

// Mount proxy route
app.all('/v1/*', async (c) => {
  const store = new KVStore(c.env.AIGATEWAY)
  const keyPool = new KeyPool(store, c.env.SALT)

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const userKeyValue = authHeader.slice(7)
  const userKeyIds = await store.getUserKeyIds()

  let userKeyEnabled = false
  for (const id of userKeyIds) {
    const key = await store.getUserKey(id)
    if (key && key.fullKey === userKeyValue) {
      userKeyEnabled = key.enabled
      break
    }
  }

  if (!userKeyEnabled) {
    return c.json({ error: 'Invalid or disabled API key' }, 403)
  }

  const upstream = await keyPool.getUpstreamKey(userKeyValue)
  if (!upstream) {
    return c.json({ error: 'No upstream keys configured' }, 503)
  }

  const url = `${c.env.DEEPSEEK_BASE_URL}${c.req.path}`
  const headers = new Headers(c.req.raw.headers)
  headers.set('Authorization', `Bearer ${upstream.fullKey}`)
  headers.delete('Host')

  const proxyRes = await fetch(url, {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
  })

  return new Response(proxyRes.body, {
    status: proxyRes.status,
    statusText: proxyRes.statusText,
    headers: proxyRes.headers,
  })
})

// Root redirect
app.get('/', (c) => c.redirect('/admin'))

export default app
```

**Step 2: Verify the build compiles**

Run: `npx wrangler deploy --dry-run`

**Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat: wire together all routes in entry point"
```

---

### Task 10: wrangler.toml Configuration

**Files:**
- Modify: `wrangler.toml`

**Step 1: Write final wrangler.toml**

```toml
name = "deepseek-gateway"
main = "src/index.tsx"
compatibility_date = "2025-01-01"
minify = true

[[kv_namespaces]]
binding = "AIGATEWAY"
id = "your-kv-id"
preview_id = "your-preview-kv-id"

[vars]
ADMIN_DEFAULT_PASSWORD = "admin123"
JWT_SECRET = "change-me-in-production-use-random-string"
SALT = "gateway-salt-2026"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
```

**Step 2: Create KV namespace**

```bash
npx wrangler kv:namespace create AIGATEWAY
npx wrangler kv:namespace create AIGATEWAY --preview
```

**Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "chore: configure wrangler.toml with KV bindings"
```

---

### Task 11: Smoke Test & Deploy

**Step 1: Run locally**

```bash
npx wrangler dev
```

**Step 2: Test admin login**

```bash
# Visit http://localhost:8787/admin/login
# Login with default password "admin123"
```

**Step 3: Test proxy endpoint**

```bash
# With a user key created in admin:
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <user-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

**Step 4: Test SSE streaming**

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <user-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

**Step 5: Deploy**

```bash
npx wrangler deploy
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: final configuration and deployment readiness"
```
