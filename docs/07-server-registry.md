# Server Registry

MG-006 的第一步是把 MCP 配置从写死的 Filesystem PoC 中拆出来。

## 存储

默认位置：

```text
~/Library/Application Support/MCP Gate/servers.json
```

当前个人使用采用 JSON 存储，没有计划为了聚合功能迁移 SQLite。

写入采用同目录临时文件 + rename，文件权限为 `0600`，覆盖前保存轮转备份。
持久化失败时恢复 Store 内存；备份恢复后通过 `reload()` 重读配置，
不在 reload 中修复或重建文件。

## API

```text
GET    /api/server-configs
POST   /api/server-configs
POST   /api/server-configs/:id
POST   /api/server-configs/:id/environment
POST   /api/server-configs/:id/settings
DELETE /api/server-configs/:id
```

POST 支持 stdio 与 HTTP 配置，以下为 stdio 示例：

```json
{
  "name": "GitHub",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "cwd": "/Users/me/project"
}
```

创建和编辑 stdio 配置时可同时提交 `env`、`secretEnvKeys`、`secretEnv`，
Service 将基础配置与环境保存为一次 registry 写入；运行中的编辑仅重连一次。
省略这些字段时保留既有环境，显式提交空对象/空数组时清空环境。
旧 environment-only endpoint 仍兼容。Secret 明文只进入安全存储，不写入 registry。

## 当前边界

配置可通过桌面端增删改；`ServerService` 协调配置、凭据和运行时变更。
`UpstreamManager` 使用 stdio 或 HTTP MCP transport 连接上游，再由统一
GatewayServer 聚合 Tools，不为每个配置启动独立公开 proxy。
连接/断开/刷新工具使用 `/api/upstreams/:id/connect|disconnect|refresh-tools`。
