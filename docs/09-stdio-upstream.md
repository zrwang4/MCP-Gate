# Stdio Upstream Client

MCP Gate 现在使用 MCP TypeScript SDK v2 的客户端包：

```text
@modelcontextprotocol/client@2.0.0
```

每个已保存的 stdio MCP 配置通过：

```text
Client
  +
StdioClientTransport
```

建立真实 MCP 连接。

## 生命周期

```text
configured
   ↓ connect
connecting
   ↓ initialize + tools/list
running
   ↓ disconnect
stopped
```

连接成功后 ToolRegistry 会登记所有工具，公开名称仍由 MCP Gate 自己生成。

## API

```text
POST /api/upstreams/:id/connect
POST /api/upstreams/:id/disconnect
POST /api/upstreams/:id/refresh-tools
```

下一阶段是把 ToolRegistry 暴露给统一 GatewayServer 的 `tools/list` / `tools/call`。
