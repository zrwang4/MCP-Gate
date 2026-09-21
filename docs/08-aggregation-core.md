# Aggregation Core Skeleton

本阶段加入两个聚合核心模块，但还没有接入真实 MCP stdio transport。

## ToolRegistry

职责：

- 为每个 upstream 的 tool 生成公开名称。
- 显式保存 `publicName -> serverId + originalName`。
- 支持 Tool enable/disable。
- Server 断开时一次性删除对应工具。
- namespace 冲突时自动生成稳定的后缀名称。

示例：

```text
GitHub / create_issue
→ github__create_issue
```

路由时不使用 `split("__")`。

## UpstreamManager

状态：

```text
configured
connecting
running
stopping
stopped
error
```

职责：

- 从 ServerRegistry 同步配置。
- 通过可注入 factory 创建 MCP client。
- connect 后缓存 `tools/list` 到 ToolRegistry。
- `callTool(publicName)` 根据 ToolRegistry 路由到原始 upstream。
- disconnect 时清除工具。

## Management API

新增：

```text
GET /api/upstreams
GET /api/tools
```

下一步会实现真实 `StdioUpstreamClient`，替换当前生产环境里的占位 factory。
