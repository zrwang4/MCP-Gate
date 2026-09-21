# MCP Gate

A lightweight macOS-first MCP Gateway desktop app.

Current milestone: **P0 / MG-001 ~ MG-005**

- Monorepo skeleton
- Tauri 2 + React desktop shell
- Node/TypeScript Core PoC
- `mcp-proxy` 6.7.18 integration
- Filesystem MCP PoC exposed at `http://127.0.0.1:24888/mcp`

## Prerequisites

- Node.js 22+
- pnpm 10+
- For desktop development: Rust toolchain + Tauri prerequisites

## Install

```bash
corepack enable
pnpm install
```

## Run the Core PoC

Allow MCP access to a test directory only:

```bash
MCP_GATE_FILESYSTEM_ROOT="$HOME/Desktop/mcp-gate-test" pnpm core:dev
```

The gateway listens on:

```text
http://127.0.0.1:24888/mcp
```

Health endpoint:

```bash
curl http://127.0.0.1:24888/ping
```

## Run desktop UI

```bash
pnpm desktop:dev
```

See `docs/04-poc-runbook.md` for details.
