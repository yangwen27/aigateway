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
