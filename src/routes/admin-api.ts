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

  app.use('*', (c, next) => auth.middleware(c, next))

  app.post('/login', (c) => auth.loginHandler(c))

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

  app.put('/password', (c) => auth.changePassword(c))

  return app
}
