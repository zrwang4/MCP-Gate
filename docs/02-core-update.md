# MCP Gate — Core Upgrade Design

## Status: future design, not implemented

The current app bundles Node and a compiled Core runtime. It does not download
candidate Core versions, switch `current.json`, self-test an update or
automatically roll back. Tauri Updater is also intentionally disabled; see
[current updater status](35-tauri-updater.md).

The sections below describe the proposed independent Core updater. App and Core
release versions are currently checked for consistency by `release:check`;
`mcp-proxy` is separately version-pinned.

```text
App Version
Core Version
mcp-proxy Version
```

Proposed Core layout (not the current installed layout):

```text
~/Library/Application Support/MCP Gate/core/
├── 1.0.0/
├── 1.1.0/
└── current.json
```

Formal releases should distribute tested MCP Gate Core archives rather than blindly installing GitHub source ZIPs.

Update flow:

```text
check
→ download
→ checksum
→ unpack to candidate
→ self-test
→ start candidate
→ health check
→ switch active version
→ keep previous version for rollback
```

If candidate startup or health check fails, automatically restore the previous Core.

`mcp-proxy` is pinned independently from the App and Core. Upgrades should first pass MCP Gate's `McpProxyGateway` compatibility tests before being promoted to Stable; keep its API behind the adapter and do not float to a new version automatically.
