# Server Registry

MG-006 的第一步是把 MCP 配置从写死的 Filesystem PoC 中拆出来。

## 存储

默认位置：

```text
~/Library/Application Support/MCP Gate/servers.json
```

当前使用 JSON 是为了减少 MVP 依赖；多 MCP 聚合稳定后再迁移 SQLite。

写入采用同目录临时文件 + rename，文件权限为 `0600`。

## API

```text
GET    /api/server-configs
POST   /api/server-configs
DELETE /api/server-configs/:id
```

POST 当前支持 stdio 配置：

```json
{
  "name": "GitHub",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "cwd": "/Users/me/project"
}
```

## 当前边界

这些配置已经可以在桌面端新增和删除，但暂时不会各自启动独立公开 proxy。

下一步将由 `UpstreamManager` 读取 Server Registry，用 MCP client transport 连接各个 stdio upstream，再由统一 GatewayServer 聚合 Tools。
