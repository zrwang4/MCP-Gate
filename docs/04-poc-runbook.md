# P0 PoC Runbook — MG-001 ~ MG-005

## Goal

Prove this path before building multi-server aggregation:

```text
Filesystem MCP (stdio)
        ↓
    mcp-proxy
        ↓
Streamable HTTP /mcp
        ↓
 MCP Client / Inspector
```

`mcp-proxy` is pinned to `6.7.18` for the PoC. The package currently serves both 2025-era clients and the 2026-07-28 protocol on `/mcp`; legacy `/sse` is deliberately disabled in this PoC.

## 1. Install dependencies

```bash
corepack enable
pnpm install
```

## 2. Filesystem test directory

Core now creates a dedicated safe directory automatically:

```text
~/Library/Application Support/MCP Gate/filesystem
```

To use another directory, set `MCP_GATE_FILESYSTEM_ROOT`.

## 3. Start Core

```bash
pnpm core:dev
```

Expected final log contains a JSON line similar to:

```json
{
  "event": "core.ready",
  "gatewayUrl": "http://127.0.0.1:24888/mcp"
}
```

## 4. Smoke-check the HTTP listener

```bash
pnpm core:smoke
```

or:

```bash
curl http://127.0.0.1:24888/ping
```

## 5. Start desktop shell

In another terminal:

```bash
pnpm desktop:dev
```

The dashboard currently checks `/ping`, displays gateway state, and lets you copy the endpoint.

## 6. Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `MCP_GATE_FILESYSTEM_ROOT` | App Support filesystem dir | Directory exposed by Filesystem MCP |
| `MCP_GATE_HOST` | `127.0.0.1` | Gateway bind host |
| `MCP_GATE_PORT` | `24888` | Gateway port |
| `MCP_GATE_CONNECTION_TIMEOUT_MS` | `60000` | Upstream startup timeout |
| `MCP_GATE_REQUEST_TIMEOUT_MS` | `300000` | MCP request timeout |
| `MCP_GATE_SESSION_IDLE_TIMEOUT_MS` | `1800000` | Idle session cleanup |

## Current limitations

This milestone intentionally uses `mcp-proxy` as a child process and proxies exactly one Filesystem MCP server. That is a **PoC implementation detail**, not the target architecture.

MG-006 onward will introduce:

- `GatewayServer`
- `UpstreamManager`
- `ToolRegistry`
- `ToolRouter`
- multiple upstream servers behind one `/mcp`
- Tauri-managed Core lifecycle

The Core package boundary introduced here remains; the internal adapter can be replaced without changing the UI contract.
