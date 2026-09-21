# Gateway API Key

The public MCP endpoint can optionally require a Bearer token.

Default:

```text
http://127.0.0.1:24888/mcp
auth: disabled
```

After enabling:

```http
Authorization: Bearer <gateway-api-key>
```

## Storage

`gateway-access.json` stores only an opaque Keychain reference.

The actual API Key is stored in macOS Keychain through the existing SecretStore.

The plaintext key is returned only when enabling or rotating it. The desktop UI copies it to the clipboard and keeps it only in React memory until dismissed.

## Fail closed

If `gateway-access.json` says authentication is enabled but the Keychain item cannot be loaded, MCP Gate keeps authentication enabled and rejects `/mcp` with 503.

It never silently falls back to unauthenticated mode.

`/ping` remains unauthenticated for local health checks.

## Management API

```text
GET  /api/gateway-access
POST /api/gateway-access/rotate
POST /api/gateway-access/disable
```

All routes are protected by the Management session token. Mutations also require the desktop client marker.
