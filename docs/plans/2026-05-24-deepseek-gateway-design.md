# DeepSeek API Gateway — Design

**Date**: 2026-05-24
**Status**: Approved

## Overview

Cloudflare Worker that proxies requests to DeepSeek API through a pool of upstream API keys. Users authenticate with gateway-managed keys (not real DeepSeek keys). The gateway selects an upstream key via consistent hashing (key affinity), forwards the request, and returns the response. Includes an admin page for key management and balance monitoring.

## Requirements

1. Deploy on Cloudflare Workers
2. KV-backed key storage; admin page with password auth to manage keys
3. Key affinity: same user key always maps to same upstream DeepSeek key
4. Balance display per upstream key on admin page
5. SSE (Server-Sent Events) passthrough for streaming endpoints
6. Transparent proxy: supports all DeepSeek API endpoints without modification

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (routing, JSX, JWT middleware, streaming)
- **Storage**: Cloudflare KV (upstream keys, user keys, balance cache)
- **Frontend**: Hono JSX (server-rendered admin page)

## Data Model (KV)

```
KV Namespace: AIGATEWAY

Key                          │ Value
─────────────────────────────┼──────────────────────────
admin:password               │ "sha256_hashed_password"
upstream:keys                │ ["ds-key-1","ds-key-2",...]
upstream:key:ds-key-1        │ {"mask":"sk-xxx...xxx","balance":12.50,"updated":1700000000}
user:keys                    │ ["user-key-1","user-key-2",...]
user:key:user-key-1          │ {"mask":"ak-xxx...xxx","enabled":true}
```

- Upstream key full values are never exposed to frontend; masked on read
- Balance is cached with TTL; refresh triggers re-fetch from DeepSeek API
- Admin password stored as SHA-256 hash
- No KV entry for user-key-to-upstream-key mapping — computed via consistent hashing

## Request Flow

```
1. Request arrives at /v1/chat/completions
   Authorization: Bearer <user_key>

2. Authentication:
   Read user:keys list → find user_key → verify enabled=true
   If invalid → 401

3. Upstream selection (consistent hashing):
   upstream_keys = read("upstream:keys")
   idx = fnv1a(user_key + salt) % len(upstream_keys)
   real_key = upstream_keys[idx]

4. Forwarding:
   Replace Authorization header with real DeepSeek key
   Passthrough: method, body, Content-Type, Accept, all other headers
   No body parsing — all requests proxied as-is

5. Response:
   Normal → passthrough JSON response
   Streaming (stream=true) → passthrough text/event-stream via Hono stream()
```

### Consistent Hashing

- `hash = fnv1a(user_key + salt)` where salt is a Worker secret (env var)
- Adding/removing upstream keys only remaps `(old_pool_size / new_pool_size)` proportion of users
- No weight, no fallback — keys are up/down via admin page (enable/disable)

## Admin Page

### Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/login` | Password login, returns JWT cookie |
| GET | `/admin/api/keys` | List upstream keys (masked) + balance |
| POST | `/admin/api/keys` | Add upstream key |
| DELETE | `/admin/api/keys/:id` | Delete upstream key |
| POST | `/admin/api/keys/refresh-balance` | Refresh all key balances |
| GET | `/admin/api/user-keys` | List user keys |
| POST | `/admin/api/user-keys` | Create user key |
| DELETE | `/admin/api/user-keys/:id` | Delete user key |
| PUT | `/admin/api/user-keys/:id/toggle` | Enable/disable user key |
| PUT | `/admin/api/password` | Change admin password |

### UI

Server-rendered via Hono JSX. Two sections: Upstream Keys (with balance) and User Keys (with enable/disable toggle). Password change form. First login forces password change from default.

### Auth

- JWT stored in HttpOnly Secure SameSite=Strict cookie
- Token valid for 2 hours
- Default password set via Worker env var; must be changed on first login

## Project Structure

```
├── src/
│   ├── index.ts              # Worker entry, route registration
│   ├── routes/
│   │   ├── proxy.ts          # /v1/* — API proxy
│   │   └── admin.ts          # /admin/* — admin routes + JSX
│   ├── services/
│   │   ├── key-pool.ts       # Consistent hashing & key selection
│   │   ├── proxy.ts          # Request forwarding to DeepSeek
│   │   └── balance.ts        # Balance checking via DeepSeek API
│   ├── middleware/
│   │   └── auth.ts           # JWT auth for admin routes
│   ├── views/
│   │   └── admin.tsx         # Admin page JSX template
│   └── types.ts
├── wrangler.toml
└── package.json
```

## Error Handling

- Invalid user key → 401
- Disabled user key → 403
- No upstream keys configured → 503
- DeepSeek API error → passthrough the error response as-is
- Admin API errors → JSON error with message
