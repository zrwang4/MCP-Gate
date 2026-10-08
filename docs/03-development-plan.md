# MCP Gate — Development Plan

## Status

The lists below are the original roadmap, not a current backlog. Aggregation,
server/tool management, profiles, Keychain, tray/autostart and bundled Node/Core
are implemented. Signing/notarization and dual-architecture release workflows
are configured; successful signed publication still depends on credentials and
artifact validation. Current personal-use storage remains JSON; SQLite migration
is not scheduled. Independent Core updates/rollback are future designs, and
Tauri Updater is intentionally disabled. See [current architecture](01-product-architecture.md).

## P0: Technical PoC

- MG-001 Monorepo
- MG-002 Tauri + React shell
- MG-003 Node Core process
- MG-004 integrate `mcp-proxy`
- MG-005 Filesystem MCP PoC

## P1: Aggregation Core

- MG-006 GatewayServer
- MG-007 UpstreamManager
- MG-008 ProcessManager
- MG-009 ToolRegistry
- MG-010 ToolRouter
- MG-011 multi-upstream aggregation

## P2: Desktop MVP

- server CRUD
- start / stop
- tool list / toggle
- logs
- settings
- Tauri-managed Core lifecycle

## P3: Productization

- SQLite
- Keychain
- Tray
- Autostart
- signing/notarization
- DMG
- Core updater + rollback

## Engineering priorities

```text
correctness
> stability
> isolation/recovery
> aggregation
> UI polish
> advanced features
```
