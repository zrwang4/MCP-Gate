# Next Implementation Slice — MG-006 ~ MG-011

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
5. The current CLI adapter is temporary. The next adapter should use `mcp-proxy`'s programmatic `startHTTPServer()` boundary.
