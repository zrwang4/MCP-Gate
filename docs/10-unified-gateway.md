# Unified Gateway Server

MCP Gate 的公开 MCP endpoint 现在由自有聚合 GatewayServer 提供：

```text
http://127.0.0.1:24888/mcp
```

实现基于 MCP TypeScript SDK v2：

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/node@2.0.0`

## 请求路径

```text
MCP Client
    │
    ▼
GatewayServer /mcp
    │
    ├── tools/list ← ToolRegistry
    │
    └── tools/call
           │
           ▼
     UpstreamManager
           │
           ▼
   StdioUpstreamClient
```

Gateway 的 server factory 会在每个 MCP 请求时读取当前 ToolRegistry，因此 upstream connect/disconnect 后无需重启公开 endpoint。

## 协议兼容

SDK v2 的 `createMcpHandler` 默认提供现代 2026-07-28 MCP HTTP，并使用 stateless fallback 服务 2025-era Streamable HTTP 客户端。

## mcp-proxy

旧 `McpProxyProcess` 源文件暂时保留用于兼容研究和后续 adapter，但 Core 启动路径已经不再让它占用公开 24888 端口。
