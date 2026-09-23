# Aggregation Core — Architecture Notes

## Objective

Replace the single-upstream PoC with a real aggregation layer while preserving the public endpoint:

```text
http://127.0.0.1:24888/mcp
```

## Planned modules

```text
packages/core/src/
├── gateway/
│   ├── GatewayServer.ts
│   └── McpProxyTransport.ts
├── upstream/
│   ├── UpstreamManager.ts
│   ├── StdioUpstream.ts
│   └── HttpUpstream.ts
├── tools/
│   ├── ToolRegistry.ts
│   ├── ToolRouter.ts
│   └── ToolPolicy.ts
└── process/
    └── ProcessManager.ts
```

## Rules

1. Public tool names are registered explicitly; do not route by `split("__")`.
2. `tools/list` is served from an in-memory registry, not by querying every upstream on every client request.
3. A failed upstream must not crash the gateway.
4. Tool changes rebuild the registry and emit a downstream tools-changed notification.
5. `McpProxyGateway` is the only Core module that calls `mcp-proxy` directly. It owns the public HTTP/protocol runtime through `startHTTPServer()`; MCP Gate continues to own multi-upstream aggregation and tool routing.

## Upgrade contract

- Pin `mcp-proxy` to an exact version in `packages/core/package.json` and keep both lockfiles synchronized.
- An upgrade must pass the Core test suite, including the real HTTP gateway integration test for tool listing, calls, and dynamic tool-list changes.
- Review the upstream API and protocol behavior before changing the pin; do not couple UI, management routes, or persisted configuration to upstream types.
- SSE is disabled for MCP Gate; `/mcp` remains the public Streamable HTTP endpoint.
