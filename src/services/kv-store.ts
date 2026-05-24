import type { UpstreamKeyStore, UserKeyStore } from '../types'

export class KVStore {
  constructor(private kv: KVNamespace) {}

  async getAdminPasswordHash(): Promise<string | null> {
    return this.kv.get('admin:password')
  }

  async setAdminPasswordHash(hash: string): Promise<void> {
    await this.kv.put('admin:password', hash)
  }

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
