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

      <script src="https://unpkg.com/htmx.org@1.9.10" />
      <script dangerouslySetInnerHTML={{ __html: `
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
      ` }} />
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
              document.querySelector('.error')?.remove()
              const div = document.createElement('div')
              div.className = 'error'
              div.textContent = data.error
              e.target.insertBefore(div, e.target.firstChild)
            }
          })
        ` }} />
      </div>
    </body>
  </html>
)
