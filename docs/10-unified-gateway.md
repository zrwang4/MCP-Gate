# Unified Gateway Server

MCP Gate 的公开 MCP endpoint 由 `mcp-proxy` 托管 HTTP 与协议会话，MCP Gate 提供聚合后的 MCP Server：

```text
http://127.0.0.1:24888/mcp
```

实现通过 `packages/core/src/mcp-proxy-gateway.ts` 适配 `mcp-proxy@6.7.19` 的程序化 `startHTTPServer()` API，并基于 MCP TypeScript SDK v2 创建聚合 Server：

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/node@2.0.0`

## 请求路径

```text
MCP Client
    │
    ▼
McpProxyGateway /mcp
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

Gateway 在新会话/请求中读取当前 ToolRegistry；活动会话在工具变化时同步注册并接收变更通知，因此 upstream connect/disconnect 后无需重启公开 endpoint。

## 职责边界

- `mcp-proxy` 负责 Streamable HTTP、协议会话、现代协议通知和会话回收。
- MCP Gate 的 `ToolRegistry`、`UpstreamManager` 负责多上游工具聚合、命名、过滤和调用路由。
- `McpProxyGateway` 是 `mcp-proxy` 的唯一直接接入点；升级依赖时先运行 Core 的代理兼容性测试。
- MCP Gate 只启用 `/mcp` Streamable HTTP，不启用旧 SSE endpoint。

`/ping` 由 `mcp-proxy` 提供，响应正文为 `pong`；Gateway MCP endpoint 的 Host、Origin 和 API Key 策略仍由 MCP Gate 配置并验证。
