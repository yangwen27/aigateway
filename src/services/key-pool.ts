import type { KVStore } from './kv-store'

function fnv1a(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return hash >>> 0
}

function isKeyUsable(data: { balance: number | null; disabled?: boolean }): boolean {
  if (data.disabled) return false
  if (data.balance !== null && data.balance <= 0) return false
  return true
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
    const startIdx = hash % ids.length

    // Walk the ring to find a usable key
    for (let i = 0; i < ids.length; i++) {
      const idx = (startIdx + i) % ids.length
      const id = ids[idx]
      const keyData = await this.store.getUpstreamKey(id)
      if (keyData && isKeyUsable(keyData)) {
        return { id, fullKey: keyData.fullKey }
      }
    }

    return null
  }
}
