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
