# Auto Start

每个 stdio MCP 配置已有两个运行策略字段：

```json
{
  "enabled": true,
  "autoStart": false
}
```

现在 `autoStart` 已接入真实生命周期。

## Startup

Core 启动顺序：

```text
load registry
→ start Management API
→ start unified Gateway
→ connectAutoStart()
→ ready
```

只连接：

```text
enabled === true
&&
autoStart === true
```

多个 MCP 使用独立连接结果；一个失败不会阻断其他配置。

## API

```text
POST /api/server-configs/:id/settings
```

请求：

```json
{
  "autoStart": true
}
```

也支持 `enabled`。将 `enabled` 设为 false 时，当前连接会被断开。
