# DeepSeek API Gateway

Cloudflare Worker 网关，管理多个 DeepSeek API Key，提供统一入口转发请求。

## 功能

- **Key 池管理**：支持多个上游 DeepSeek Key，一致性哈希保证用户 Key 亲和性
- **自动故障转移**：上游 Key 认证失败或余额不足时，自动删除并换下一个重试
- **余额监控**：每个上游 Key 独立查询余额，支持排序、批量刷新
- **用户 Key 分发**：生成用户 Key 分发给最终用户，可随时启用/禁用
- **透明转发**：支持所有 DeepSeek 接口（含 SSE 流式）
- **中文管理页**：Tab 布局，批量导入/删除/启用/禁用

## 快速开始

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入你的密钥
npx wrangler dev
```

## 部署

```bash
# 创建 KV 命名空间
npx wrangler kv namespace create AIGATEWAY
npx wrangler kv namespace create AIGATEWAY --preview  # 本地开发用

# 将返回的 id 和 preview_id 填入 wrangler.toml

# 上传密钥（不会提交到 Git）
npx wrangler secret put JWT_SECRET
npx wrangler secret put SALT
npx wrangler secret put ADMIN_DEFAULT_PASSWORD

npx wrangler deploy
```

## 使用

### 管理页面

打开 `https://<your-worker>.workers.dev/admin`，使用管理员密码登录。

1. **上游 Key**：添加你的 DeepSeek `sk-xxx` Key，可单个添加或批量导入
2. **用户 Key**：创建分发给用户的 Key（创建时仅显示一次，请立即复制）
3. **设置**：修改管理员密码

### API 调用

用户使用你创建的用户 Key 调用：

```bash
curl https://<your-worker>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer <用户Key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hello"}],"stream":false}'
```

与直接调用 DeepSeek API 完全兼容，只需替换 URL 和 API Key。

## 配置

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 管理页 JWT 签名密钥（secret） |
| `SALT` | 一致性哈希盐值（secret） |
| `ADMIN_DEFAULT_PASSWORD` | 首次登录密码（secret） |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 |

## 项目结构

```
src/
├── index.tsx            # 入口，路由注册
├── types.ts             # 类型定义
├── middleware/auth.ts   # JWT 认证
├── services/
│   ├── kv-store.ts      # KV 存储
│   ├── key-pool.ts      # 一致性哈希 Key 池
│   └── balance.ts       # 余额查询
├── routes/
│   ├── proxy.ts         # 代理路由（备用）
│   └── admin-api.ts     # 管理 API（备用）
└── views/
    └── admin.tsx        # 管理页面 JSX
```
