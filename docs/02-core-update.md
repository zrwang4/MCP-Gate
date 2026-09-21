# MCP Gate — Core Upgrade Design

App, Core, and `mcp-proxy` versions are independent.

```text
App Version
Core Version
mcp-proxy Version
```

Target Core layout:

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

`mcp-proxy` updates should first pass MCP Gate CI compatibility tests before being promoted to Stable.
