# Management API Authentication

Production desktop mode now protects the loopback Management API with a per-app-session random token.

## Production flow

```text
Tauri starts
  ↓
generate 64-char random token
  ↓
CoreSupervisor
  ├─ env MCP_GATE_MANAGEMENT_TOKEN=<token>
  └─ Tauri command management_token()
          ↓
       WebView
          ↓
X-MCP-Gate-Token: <token>
          ↓
127.0.0.1:24889
```

Only `GET /api/health` remains unauthenticated because CoreSupervisor uses it for reachability.

All other Management API reads and writes require authentication.

Write operations still also send `X-MCP-Gate-Client: desktop` as a lightweight defense-in-depth marker.

## Development mode

A manually started Core without `MCP_GATE_MANAGEMENT_TOKEN` keeps the legacy desktop-header fallback for local development.

To test token authentication explicitly:

```bash
MCP_GATE_MANAGEMENT_TOKEN=dev-secret pnpm core:dev
VITE_MCP_GATE_MANAGEMENT_TOKEN=dev-secret pnpm desktop:web
```

The token is never written to `servers.json`, logs, or the UI.
