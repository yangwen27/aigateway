import { Hono } from 'hono'
import type { KVStore } from '../services/kv-store'
import type { KeyPool } from '../services/key-pool'

export function createProxyRoute(store: KVStore, keyPool: KeyPool, deepseekBaseUrl: string): Hono {
  const app = new Hono()

  app.all('/v1/*', async (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401)
    }

    const userKeyValue = authHeader.slice(7)
    const userKeyIds = await store.getUserKeyIds()

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

    const upstream = await keyPool.getUpstreamKey(userKeyValue)
    if (!upstream) {
      return c.json({ error: 'No upstream keys configured' }, 503)
    }

    const url = `${deepseekBaseUrl}${c.req.path}`
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

  return app
}
