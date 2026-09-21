# Unified Gateway Server

MG-010 将公开入口从单 Filesystem PoC 切换为真正的聚合 Gateway。

```text
Claude / Cursor / Codex
          │
          ▼
http://127.0.0.1:24888/mcp
          │
     GatewayServer
       │       │
 tools/list  tools/call
       │       │
       └── ToolRegistry
                │
          UpstreamManager
          │     │     │
        MCP A  MCP B  MCP C
```

## HTTP serving

使用：

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/node@2.0.0`
- `createMcpHandler`
- `toNodeHandler`
- localhost Host / Origin validation

`createMcpHandler` 的 factory 每个请求创建一个轻量 low-level `Server`，
共享的 ToolRegistry 与 UpstreamManager 保持在进程级。

## Dynamic tools

Gateway 使用 low-level `Server`，原因是 upstream 的 `tools/list`
提供的是 JSON Schema，而不是本地 Standard Schema/Zod schema。

```text
tools/list
→ ToolRegistry.list()
→ 原样公开 upstream inputSchema

tools/call
→ ToolRegistry.resolve(publicName)
→ UpstreamManager.callTool()
→ upstream original tool
```

## Compatibility

旧 `proxy-process.ts` 与 `mcp-proxy` 依赖暂时保留，但不会再启动并占用 24888。
后续可以作为单服务器兼容模式或迁移工具。
