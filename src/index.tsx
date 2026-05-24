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
      return { id, mask: data?.mask ?? id, balance: data?.balance, disabled: data?.disabled }
    })
  )

  // Sort
  const sort = c.req.query('sort')
  const order = c.req.query('order') || 'asc'
  if (sort === 'balance') {
    upstreamKeys.sort((a, b) => {
      const va = a.balance ?? -Infinity
      const vb = b.balance ?? -Infinity
      return order === 'desc' ? vb - va : va - vb
    })
  }

  const userKeyIds = await store.getUserKeyIds()
  const userKeys = await Promise.all(
    userKeyIds.map(async (id) => {
      const data = await store.getUserKey(id)
      return { id, mask: data?.mask ?? id, enabled: data?.enabled ?? true }
    })
  )

  return c.html(<AdminPage upstreamKeys={upstreamKeys} userKeys={userKeys} sort={sort} order={order} />)
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
  if (!key) return c.json({ error: 'Key 不能为空' }, 400)

  // Check duplicate
  const existingIds = await store.getUpstreamKeyIds()
  for (const eid of existingIds) {
    const ek = await store.getUpstreamKey(eid)
    if (ek && ek.fullKey === key) {
      return c.json({ error: 'Key 已存在', duplicate: eid }, 409)
    }
  }

  const id = crypto.randomUUID().slice(0, 8)
  await store.setUpstreamKey(id, {
    fullKey: key,
    mask: maskKey(key),
    balance: null,
    balanceUpdated: 0,
  })

  existingIds.push(id)
  await store.setUpstreamKeyIds(existingIds)

  return c.json({ id, mask: maskKey(key) }, 201)
})

adminApi.post('/keys/batch', async (c) => {
  const { store } = getServices(c)
  const { keys } = await c.req.json<{ keys: string[] }>()
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    return c.json({ error: 'Keys array is required' }, 400)
  }

  const ids = await store.getUpstreamKeyIds()

  // Load existing full keys for dedup
  const existingKeys = new Set<string>()
  for (const eid of ids) {
    const ek = await store.getUpstreamKey(eid)
    if (ek) existingKeys.add(ek.fullKey)
  }

  const results: { id: string; mask: string; key: string }[] = []
  let skipped = 0

  for (const key of keys) {
    const trimmed = key.trim()
    if (!trimmed) continue
    if (existingKeys.has(trimmed)) { skipped++; continue }

    const id = crypto.randomUUID().slice(0, 8)
    await store.setUpstreamKey(id, {
      fullKey: trimmed,
      mask: maskKey(trimmed),
      balance: null,
      balanceUpdated: 0,
    })
    ids.push(id)
    existingKeys.add(trimmed)
    results.push({ id, mask: maskKey(trimmed), key: trimmed })
  }

  await store.setUpstreamKeyIds(ids)

  return c.json({ imported: results.length, skipped, results }, 201)
})

adminApi.delete('/keys/:id', async (c) => {
  const { store } = getServices(c)
  const { id } = c.req.param()
  const ids = await store.getUpstreamKeyIds()
  const filtered = ids.filter((i) => i !== id)

  if (filtered.length === ids.length) {
    return c.json({ error: 'Key 不存在' }, 404)
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
  if (!ids || !Array.isArray(ids)) return c.json({ error: '需要提供 ids 数组' }, 400)

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
  if (!ids || !Array.isArray(ids)) return c.json({ error: '需要提供 ids 数组' }, 400)

  const allIds = await store.getUpstreamKeyIds()
  const toDelete = new Set(ids)
  const remaining = allIds.filter((id) => !toDelete.has(id))

  for (const id of ids) {
    await store.deleteUpstreamKey(id)
  }
  await store.setUpstreamKeyIds(remaining)

  return c.json({ ok: true, deleted: ids.length })
})

adminApi.post('/keys/cleanup-zero-balance', async (c) => {
  const { store } = getServices(c)
  const ids = await store.getUpstreamKeyIds()
  const toDelete: string[] = []

  for (const id of ids) {
    const data = await store.getUpstreamKey(id)
    if (data && data.balance !== null && data.balance <= 0) {
      toDelete.push(id)
    }
  }

  for (const id of toDelete) {
    await store.deleteUpstreamKey(id)
  }

  if (toDelete.length > 0) {
    await store.setUpstreamKeyIds(ids.filter((id) => !toDelete.includes(id)))
  }

  return c.json({ ok: true, deleted: toDelete.length, ids: toDelete })
})

adminApi.put('/keys/:id/toggle', async (c) => {
  const { store } = getServices(c)
  const { id } = c.req.param()
  const keyData = await store.getUpstreamKey(id)
  if (!keyData) return c.json({ error: 'Key 不存在' }, 404)
  keyData.disabled = !keyData.disabled
  await store.setUpstreamKey(id, keyData)
  return c.json({ id, disabled: keyData.disabled })
})

adminApi.post('/keys/:id/refresh-balance', async (c) => {
  const { balanceService } = getServices(c)
  const { id } = c.req.param()
  const balance = await balanceService.refreshBalance(id)
  if (balance === null) return c.json({ error: '刷新余额失败' }, 500)
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
  if (!key) return c.json({ error: 'Key 不能为空' }, 400)

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
    return c.json({ error: 'Key 不存在' }, 404)
  }

  await store.setUserKeyIds(filtered)
  await store.deleteUserKey(id)

  return c.json({ ok: true })
})

adminApi.put('/user-keys/:id/toggle', async (c) => {
  const { store } = getServices(c)
  const { id } = c.req.param()
  const keyData = await store.getUserKey(id)
  if (!keyData) return c.json({ error: 'Key 不存在' }, 404)

  keyData.enabled = !keyData.enabled
  await store.setUserKey(id, keyData)

  return c.json({ id, enabled: keyData.enabled })
})

adminApi.put('/password', async (c) => {
  const { auth } = getServices(c)
  return auth.changePassword(c)
})

app.route('/admin/api', adminApi)

// Root redirect
app.get('/', (c) => c.redirect('/admin'))

// --- Proxy: catch-all for non-admin paths ---

app.all('*', async (c) => {
  // Skip admin routes
  if (c.req.path.startsWith('/admin')) return c.notFound()

  const { store, keyPool } = getServices(c)

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '缺少或无效的 Authorization header' }, 401)
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
    return c.json({ error: 'API key 无效或已禁用' }, 403)
  }

  const upstream = await keyPool.getUpstreamKey(userKeyValue)
  if (!upstream) {
    return c.json({ error: '没有可用的上游 Key' }, 503)
  }

  let currentUpstream: { id: string; fullKey: string } | null = upstream
  let proxyRes: Response | null = null

  while (currentUpstream) {
    const fetchUrl = `${c.env.DEEPSEEK_BASE_URL}${c.req.path}`
    const fetchHeaders = new Headers(c.req.raw.headers)
    fetchHeaders.set('Authorization', `Bearer ${currentUpstream.fullKey}`)
    fetchHeaders.delete('Host')

    proxyRes = await fetch(fetchUrl, {
      method: c.req.method,
      headers: fetchHeaders,
      body: c.req.raw.body,
    })

    // 400: client error, don't retry
    if (proxyRes.status === 400) {
      return c.json({
        error: {
          message: '请求格式错误，请检查请求体格式',
          type: 'bad_request',
          code: 'invalid_request_error',
        },
      }, 400)
    }

    // 401/402: bad key, delete and retry
    if (proxyRes.status === 401 || proxyRes.status === 402) {
      const ids = await store.getUpstreamKeyIds()
      await store.setUpstreamKeyIds(ids.filter((i) => i !== currentUpstream!.id))
      await store.deleteUpstreamKey(currentUpstream.id)

      // Try next key
      const nextKey = await keyPool.getUpstreamKey(userKeyValue)
      currentUpstream = nextKey
      continue
    }

    // Success or other errors: return as-is
    break
  }

  if (!currentUpstream) {
    return c.json({
      error: {
        message: '所有上游 Key 已失效，请添加新的 Key',
        type: 'no_available_keys',
        code: 'all_keys_exhausted',
      },
    }, 503)
  }

  return new Response(proxyRes!.body, {
    status: proxyRes!.status,
    statusText: proxyRes!.statusText,
    headers: proxyRes!.headers,
  })
})

export default app
