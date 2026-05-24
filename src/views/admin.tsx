import type { FC } from 'hono/jsx'

interface KeyInfo {
  id: string
  mask: string
  balance?: number | null
  disabled?: boolean
  enabled?: boolean
}

const baseStyle = `
  :root { --bg: #fafafa; --card: #fff; --border: #e5e5e5; --text: #1a1a1a; --muted: #888; --accent: #1a1a1a; --danger: #e00; --radius: 8px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111; --card: #1c1c1c; --border: #2a2a2a; --text: #e4e4e4; --muted: #777; --accent: #f0f0f0; --danger: #f44; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; max-width: 780px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.3px; }
  .topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
  .tab { padding: 8px 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; background: none; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all .15s; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { font-weight: 500; color: var(--muted); font-size: 11px; letter-spacing: 0.4px; }
  tr:last-child td { border-bottom: none; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: var(--bg); padding: 2px 6px; border-radius: 4px; word-break: break-all; }
  button, .btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 6px; padding: 7px 16px; font-size: 13px; font-weight: 500; cursor: pointer; background: var(--card); color: var(--text); transition: all .15s; white-space: nowrap; }
  button:hover { background: var(--bg); border-color: var(--muted); }
  .btn-primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn-primary:hover { opacity: 0.85; background: var(--accent); }
  .btn-danger { color: var(--danger); border-color: transparent; background: transparent; padding: 7px 8px; font-size: 12px; }
  .btn-danger:hover { background: #fee; }
  @media (prefers-color-scheme: dark) { .btn-danger:hover { background: #2a1010; } }
  .btn-sm { padding: 4px 8px; font-size: 12px; }
  input, textarea { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; font-family: inherit; outline: none; transition: border-color .15s; }
  input:focus, textarea:focus { border-color: var(--muted); }
  textarea { resize: vertical; width: 100%; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .gap { gap: 12px; }
  .mt { margin-top: 16px; }
  .badge { font-size: 11px; font-weight: 500; padding: 2px 10px; border-radius: 10px; }
  .badge-on { background: #e6f4ea; color: #137333; }
  .badge-off { background: #fce8e6; color: #c5221f; }
  @media (prefers-color-scheme: dark) {
    .badge-on { background: #0d2b14; color: #4ade80; }
    .badge-off { background: #2b0d0d; color: #f87171; }
  }
  .empty { color: var(--muted); font-size: 13px; padding: 12px 0; }
  .msg { font-size: 13px; color: var(--muted); }
  .hidden { display: none !important; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; z-index: 100; }
  .modal-overlay:not(.hidden) { display: flex; }
  .modal { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; width: 480px; max-width: 90vw; }
  .batch-bar { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); margin-bottom: 8px; font-size: 13px; color: var(--muted); }
  .batch-bar.hidden { display: none !important; }
  input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }
`

function sortUrl(field: string, current: string | undefined, order: string | undefined): string {
  const next = current === field && order === 'asc' ? 'desc' : 'asc'
  return `?sort=${field}&order=${next}`
}

function sortArrow(field: string, current: string | undefined, order: string | undefined): string {
  if (current !== field) return ' ↕'
  return order === 'asc' ? ' ↑' : ' ↓'
}

export const AdminPage: FC<{
  upstreamKeys: KeyInfo[]
  userKeys: KeyInfo[]
  sort?: string
  order?: string
}> = ({ upstreamKeys, userKeys, sort, order }) => (
  <html>
    <head>
      <title>Gateway</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>{baseStyle}</style>
    </head>
    <body>
      <div class="topbar">
        <h1>Gateway</h1>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="switchTab('upstream')">上游 Key</button>
        <button class="tab" onclick="switchTab('user')">用户 Key</button>
        <button class="tab" onclick="switchTab('settings')">设置</button>
      </div>

      {/* Upstream Keys Tab */}
      <div id="tab-upstream" class="card">
        <div id="batch-bar" class="batch-bar hidden">
          <span id="batch-count">已选 0 项</span>
          <button class="btn-sm" onclick="batchToggle(false)">启用</button>
          <button class="btn-sm" onclick="batchToggle(true)">禁用</button>
          <button class="btn-sm btn-danger" onclick="batchDelete()" style="color:var(--danger)">批量删除</button>
          <button class="btn-sm" onclick="clearSelection()">取消选择</button>
        </div>
        <table>
          <thead><tr><th style="width:30px"><input type="checkbox" id="select-all" onchange="toggleAll(this)" /></th><th>Key</th><th style="width:64px">状态</th><th style="width:90px"><a href={sortUrl('balance', sort, order)} style="color:inherit;text-decoration:none;cursor:pointer;">余额{sortArrow('balance', sort, order)}</a></th><th style="width:140px"></th></tr></thead>
          <tbody id="upstream-tbody">
            {upstreamKeys.length === 0
              ? <tr><td colSpan={5} class="empty">暂无上游 Key</td></tr>
              : upstreamKeys.map((k) => (
                  <tr id={`upstream-row-${k.id}`}>
                    <td><input type="checkbox" class="key-checkbox" value={k.id} onchange="updateBatchBar()" /></td>
                    <td><code>{k.mask}</code></td>
                    <td>
                      <span class={`badge ${k.disabled ? 'badge-off' : 'badge-on'}`}>
                        {k.disabled ? '禁用' : '启用'}
                      </span>
                    </td>
                    <td style="color:var(--muted)" class={`balance-${k.id}`}>{k.balance != null ? `¥${k.balance.toFixed(2)}` : '—'}</td>
                    <td>
                      <div class="row" style="gap:4px">
                        <button class="btn-sm" onclick={`refreshKeyBalance('${k.id}', this)`} title="刷新余额">↻</button>
                        <button class="btn-sm" hx-put={`/admin/api/keys/${k.id}/toggle`} hx-swap="none">{k.disabled ? '启用' : '禁用'}</button>
                        <button class="btn-danger" hx-delete={`/admin/api/keys/${k.id}`} hx-confirm="确定删除此 Key？">删除</button>
                      </div>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
        <div class="row gap mt">
          <input type="text" id="new-upstream-key" placeholder="sk-..." style="width:260px" />
          <button class="btn-primary" onclick="addUpstreamKey()">添加</button>
          <button onclick="toggleBatchImport()">批量导入</button>
          <button onclick="refreshAllBalances()">刷新全部余额</button>
        </div>
        <div id="batch-import" style="display:none;" class="mt">
          <textarea id="batch-keys" placeholder={`每行一个 Key\nsk-key1\nsk-key2\nsk-key3`} rows={5}></textarea>
          <div class="row gap" style="margin-top:8px;">
            <button class="btn-primary" onclick="batchImport()">导入</button>
            <span id="batch-result" class="msg"></span>
          </div>
        </div>
      </div>

      {/* User Keys Tab */}
      <div id="tab-user" class="card hidden">
        <table>
          <thead><tr><th>Key</th><th style="width:80px">状态</th><th style="width:100px"></th></tr></thead>
          <tbody>
            {userKeys.length === 0
              ? <tr><td colSpan={3} class="empty">暂无用户 Key</td></tr>
              : userKeys.map((k) => (
                  <tr>
                    <td><code>{k.mask}</code></td>
                    <td>
                      <span class={`badge ${k.enabled ? 'badge-on' : 'badge-off'}`}>
                        {k.enabled ? '启用' : '禁用'}
                      </span>
                    </td>
                    <td>
                      <div class="row">
                        <button class="btn-sm" hx-put={`/admin/api/user-keys/${k.id}/toggle`} hx-swap="none">
                          {k.enabled ? '禁用' : '启用'}
                        </button>
                        <button class="btn-danger" hx-delete={`/admin/api/user-keys/${k.id}`} hx-confirm="确定删除此 Key？">删除</button>
                      </div>
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
        <div class="row gap mt">
          <input type="text" id="new-user-key" placeholder="Key 前缀，如 ak-" style="width:200px" />
          <button class="btn-primary" onclick="createUserKey()">创建</button>
        </div>
      </div>

      {/* Settings Tab */}
      <div id="tab-settings" class="card hidden">
        <div class="row gap">
          <input type="password" id="old-password" placeholder="当前密码" style="width:180px" />
          <input type="password" id="new-password" placeholder="新密码" style="width:180px" />
          <button onclick="changePassword()">修改密码</button>
        </div>
        <div id="password-msg" class="msg" style="margin-top:8px;"></div>
      </div>

      {/* Key Created Modal */}
      <div id="key-modal" class="modal-overlay hidden">
        <div class="modal">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px;">Key 已创建</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">请立即复制，关闭后不再显示</div>
          <div class="row">
            <code id="key-modal-value" style="flex:1;padding:10px 14px;font-size:13px;word-break:break-all;user-select:all;"></code>
            <button class="btn-primary btn-sm" onclick="copyKey()" style="flex-shrink:0;">复制</button>
          </div>
          <div style="margin-top:16px;text-align:right;">
            <button onclick="closeKeyModal()">关闭</button>
          </div>
        </div>
      </div>

      <script src="https://unpkg.com/htmx.org@1.9.10" />
      <script dangerouslySetInnerHTML={{ __html: `
        function switchTab(name) {
          document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.textContent.trim().startsWith(name === 'upstream' ? '上游' : name === 'user' ? '用户' : '设置'))
          })
          document.getElementById('tab-upstream').classList.toggle('hidden', name !== 'upstream')
          document.getElementById('tab-user').classList.toggle('hidden', name !== 'user')
          document.getElementById('tab-settings').classList.toggle('hidden', name !== 'settings')
        }

        async function api(method, path, body) {
          const res = await fetch('/admin/api' + path, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          })
          if (res.status === 401) { location.href = '/admin/login'; return }
          return res.json()
        }

        // --- Checkbox / Batch ---

        function getCheckedIds() {
          return [...document.querySelectorAll('.key-checkbox:checked')].map(cb => cb.value)
        }

        function updateBatchBar() {
          const ids = getCheckedIds()
          document.getElementById('batch-count').textContent = '已选 ' + ids.length + ' 项'
          document.getElementById('batch-bar').classList.toggle('hidden', ids.length === 0)
          document.getElementById('select-all').indeterminate = ids.length > 0 && ids.length < document.querySelectorAll('.key-checkbox').length
        }

        function toggleAll(el) {
          document.querySelectorAll('.key-checkbox').forEach(cb => cb.checked = el.checked)
          updateBatchBar()
        }

        function clearSelection() {
          document.querySelectorAll('.key-checkbox').forEach(cb => cb.checked = false)
          document.getElementById('select-all').checked = false
          updateBatchBar()
        }

        async function batchToggle(disabled) {
          const ids = getCheckedIds()
          if (!ids.length) return
          await api('POST', '/keys/batch-toggle', { ids, disabled })
          location.reload()
        }

        async function batchDelete() {
          const ids = getCheckedIds()
          if (!ids.length) return
          if (!confirm('确定删除选中的 ' + ids.length + ' 个 Key？')) return
          await api('POST', '/keys/batch-delete', { ids })
          location.reload()
        }

        // --- Single key actions ---

        async function addUpstreamKey() {
          const input = document.getElementById('new-upstream-key')
          const key = input.value.trim()
          if (!key) return
          await api('POST', '/keys', { key })
          location.reload()
        }

        function toggleBatchImport() {
          const el = document.getElementById('batch-import')
          el.style.display = el.style.display === 'none' ? 'block' : 'none'
        }

        async function batchImport() {
          const textarea = document.getElementById('batch-keys')
          const keys = textarea.value.split(/[\\n,]+/).map(k => k.trim()).filter(k => k)
          if (!keys.length) return
          const result = await api('POST', '/keys/batch', { keys })
          document.getElementById('batch-result').textContent = '已导入 ' + result.imported + ' 个 key'
          setTimeout(() => location.reload(), 800)
        }

        async function refreshKeyBalance(id, btn) {
          btn.textContent = '...'
          const result = await api('POST', '/keys/' + id + '/refresh-balance')
          btn.textContent = '↻'
          if (result && result.balance != null) {
            const el = document.querySelector('.balance-' + id)
            if (el) el.textContent = '¥' + result.balance.toFixed(2)
          }
        }

        async function refreshAllBalances() {
          await api('POST', '/keys/refresh-balance')
          location.reload()
        }

        // --- User keys ---

        async function createUserKey() {
          const input = document.getElementById('new-user-key')
          const prefix = input.value.trim()
          if (!prefix) return
          const key = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
          const result = await api('POST', '/user-keys', { key })
          if (result.key) {
            document.getElementById('key-modal-value').textContent = result.key
            document.getElementById('key-modal').classList.remove('hidden')
          } else {
            location.reload()
          }
        }

        function copyKey() {
          const val = document.getElementById('key-modal-value').textContent
          navigator.clipboard.writeText(val).then(() => {
            const btn = document.querySelector('#key-modal .btn-primary')
            if (btn) { btn.textContent = '已复制'; setTimeout(() => btn.textContent = '复制', 1500) }
          })
        }

        function closeKeyModal() {
          document.getElementById('key-modal').classList.add('hidden')
          location.reload()
        }

        // --- Password ---

        async function changePassword() {
          const oldPw = document.getElementById('old-password').value
          const newPw = document.getElementById('new-password').value
          if (!oldPw || !newPw) return
          const result = await api('PUT', '/password', { oldPassword: oldPw, newPassword: newPw })
          const msg = document.getElementById('password-msg')
          if (result.ok) {
            msg.innerHTML = '密码已修改'
            setTimeout(() => location.href = '/admin/login', 1200)
          } else {
            msg.innerHTML = result.error
          }
        }

        document.body.addEventListener('htmx:afterRequest', (e) => {
          if (e.detail.requestConfig.method === 'get') return
          if (e.detail.requestConfig.path.startsWith('/admin/api/keys') && e.detail.requestConfig.method === 'put') {
            location.reload()
          } else if (e.detail.requestConfig.method !== 'get') {
            location.reload()
          }
        })
      ` }} />
    </body>
  </html>
)

export const LoginPage: FC<{ error?: string }> = ({ error }) => (
  <html>
    <head>
      <title>Gateway</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif; background: #111; color: #e4e4e4; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .box { width: 340px; }
        h1 { font-size: 18px; font-weight: 600; margin-bottom: 24px; text-align: center; letter-spacing: -0.3px; }
        input { background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 8px; padding: 12px 16px; color: #e4e4e4; width: 100%; font-size: 14px; margin-bottom: 12px; outline: none; transition: border-color .15s; }
        input:focus { border-color: #555; }
        button { width: 100%; border: none; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 500; cursor: pointer; background: #f0f0f0; color: #111; transition: opacity .15s; }
        button:hover { opacity: 0.85; }
        .err { color: #f87171; font-size: 13px; margin-bottom: 12px; }
      `}</style>
    </head>
    <body>
      <div class="box">
        <h1>Gateway</h1>
        {error && <div class="err">{error}</div>}
        <form method="post" action="/admin/api/login" id="login-form">
          <input type="password" name="password" placeholder="管理员密码" autofocus />
          <button type="submit">登录</button>
        </form>
        <script dangerouslySetInnerHTML={{ __html: `
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
              document.querySelector('.err')?.remove()
              const div = document.createElement('div')
              div.className = 'err'
              div.textContent = data.error
              e.target.insertBefore(div, e.target.firstChild)
            }
          })
        ` }} />
      </div>
    </body>
  </html>
)
