import { Hono } from 'hono'

import { KVStore } from './services/kv-store'
import { KeyPool } from './services/key-pool'
import { BalanceService } from './services/balance'
import { AdminAuth } from './middleware/auth'
import { AdminPage, LoginPage } from './views/admin'

export interface Env {
  AIGATEWAY: KVNamespace
  ADMIN_DEFAULT_PASSWORD: string
  JWT_SECRET: string
  SALT: string
  DEEPSEEK_BASE_URL: string
}

const app = new Hono<{ Bindings: Env }>()

function getServices(c: { env: Env }) {
  const store = new KVStore(c.env.AIGATEWAY)
  const keyPool = new KeyPool(store, c.env.SALT)
  const balanceService = new BalanceService(store, c.env.DEEPSEEK_BASE_URL)
  const auth = new AdminAuth(store, c.env.JWT_SECRET, c.env.ADMIN_DEFAULT_PASSWORD)
  return { store, keyPool, balanceService, auth }
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 3) + '...'
  return key.slice(0, 6) + '...' + key.slice(-4)
}

// --- Login page ---

app.get('/admin/login', (c) => {
  return c.html(<LoginPage />)
})

// --- Admin page ---

app.get('/admin', async (c) => {
  const { store, auth } = getServices(c)
  const ok = await auth.verifyToken(c)
  if (!ok) return c.redirect('/admin/login')

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

// --- Admin API ---

const adminApi = new Hono<{ Bindings: Env }>()

adminApi.post('/login', async (c) => {
  const { auth } = getServices(c)
  return auth.loginHandler(c)
})

// Auth guard for all other admin API routes
adminApi.use('*', async (c, next) => {
  if (c.req.path === '/login') return next()
  const { auth } = getServices(c)
  return auth.middleware(c, next)
})

adminApi.get('/keys', async (c) => {
  const { store } = getServices(c)
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

adminApi.post('/keys', async (c) => {
  const { store } = getServices(c)
  const { key } = await c.req.json<{ key: string }>()
  if (!key) return c.json({ error: 'Key is required' }, 400)

  const id = crypto.randomUUID().slice(0, 8)
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

adminApi.post('/keys/batch', async (c) => {
  const { store } = getServices(c)
  const { keys } = await c.req.json<{ keys: string[] }>()
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return c.json({ error: 'Keys array is required' }, 400)
  }

  const ids = await store.getUpstreamKeyIds()
  const results: { id: string; mask: string; key: string }[] = []

  for (const key of keys) {
    const trimmed = key.trim()
    if (!trimmed) continue
    const id = crypto.randomUUID().slice(0, 8)
    await store.setUpstreamKey(id, {
      fullKey: trimmed,
      mask: maskKey(trimmed),
      balance: null,
      balanceUpdated: 0,
    })
    ids.push(id)
    results.push({ id, mask: maskKey(trimmed), key: trimmed })
  }

  await store.setUpstreamKeyIds(ids)

  return c.json({ imported: results.length, results }, 201)
})

adminApi.delete('/keys/:id', async (c) => {
  const { store } = getServices(c)
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

adminApi.post('/keys/refresh-balance', async (c) => {
  const { balanceService } = getServices(c)
  const results = await balanceService.refreshAllBalances()
  return c.json(Object.fromEntries(results))
})

adminApi.post('/keys/batch-toggle', async (c) => {
  const { store } = getServices(c)
  const { ids, disabled } = await c.req.json<{ ids: string[]; disabled: boolean }>()
  if (!ids || !Array.isArray(ids)) return c.json({ error: 'ids array required' }, 400)

  let count = 0
  for (const id of ids) {
    const keyData = await store.getUpstreamKey(id)
    if (keyData) {
      keyData.disabled = disabled
      await store.setUpstreamKey(id, keyData)
      count++
    }
  }
  return c.json({ ok: true, count })
})

adminApi.post('/keys/batch-delete', async (c) => {
  const { store } = getServices(c)
  const { ids } = await c.req.json<{ ids: string[] }>()
  if (!ids || !Array.isArray(ids)) return c.json({ error: 'ids array required' }, 400)

  const allIds = await store.getUpstreamKeyIds()
  const toDelete = new Set(ids)
  const remaining = allIds.filter((id) => !toDelete.has(id))

  for (const id of ids) {
    await store.deleteUpstreamKey(id)
  }
  await store.setUpstreamKeyIds(remaining)

  return c.json({ ok: true, deleted: ids.length })
})

adminApi.put('/keys/:id/toggle', async (c) => {
  const { store } = getServices(c)
  const { id } = c.req.param()
  const keyData = await store.getUpstreamKey(id)
  if (!keyData) return c.json({ error: 'Key not found' }, 404)
  keyData.disabled = !keyData.disabled
  await store.setUpstreamKey(id, keyData)
  return c.json({ id, disabled: keyData.disabled })
})

adminApi.post('/keys/:id/refresh-balance', async (c) => {
  const { balanceService } = getServices(c)
  const { id } = c.req.param()
  const balance = await balanceService.refreshBalance(id)
  if (balance === null) return c.json({ error: 'Failed to refresh' }, 500)
  return c.json({ id, balance })
})

adminApi.get('/user-keys', async (c) => {
  const { store } = getServices(c)
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

adminApi.post('/user-keys', async (c) => {
  const { store } = getServices(c)
  const { key } = await c.req.json<{ key: string }>()
  if (!key) return c.json({ error: 'Key is required' }, 400)

  const id = crypto.randomUUID().slice(0, 8)
  await store.setUserKey(id, {
    fullKey: key,
    mask: maskKey(key),
    enabled: true,
  })

  const ids = await store.getUserKeyIds()
  ids.push(id)
  await store.setUserKeyIds(ids)

  return c.json({ id, key, mask: maskKey(key) }, 201)
})

adminApi.delete('/user-keys/:id', async (c) => {
  const { store } = getServices(c)
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

adminApi.put('/user-keys/:id/toggle', async (c) => {
  const { store } = getServices(c)
  const { id } = c.req.param()
  const keyData = await store.getUserKey(id)
  if (!keyData) return c.json({ error: 'Key not found' }, 404)

  keyData.enabled = !keyData.enabled
  await store.setUserKey(id, keyData)

  return c.json({ id, enabled: keyData.enabled })
})

adminApi.put('/password', async (c) => {
  const { auth } = getServices(c)
  return auth.changePassword(c)
})

app.route('/admin/api', adminApi)

// --- Proxy: /v1/* ---

app.all('/v1/*', async (c) => {
  const { store, keyPool } = getServices(c)

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

// --- Root redirect ---

app.get('/', (c) => c.redirect('/admin'))

export default app
