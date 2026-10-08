# Tool Management

ToolRegistry 现在不仅负责 namespace 和路由，还承担运行时 Tool Policy。

## API

```text
GET  /api/tools
POST /api/tools/:publicName/enable
POST /api/tools/:publicName/disable
```

禁用后：

- Management API 仍可看到 Tool。
- Gateway `tools/list` 不再返回该 Tool。
- 即使客户端仍持有旧名称，`tools/call` 也会拒绝执行。

## Refresh behavior

同一个 upstream 刷新 `tools/list` 时，MCP Gate 按 original tool name
保留当前进程内的 enabled 状态，避免点击“刷新工具”后开关全部恢复。

开关策略由 `ToolPolicyStore` 持久化到 `tool-policy.json`，按 server ID 和
original tool name 保存禁用项。策略写入失败时恢复内存，不依赖 SQLite。
刷新先完整构建替换集合再修改注册表，失败不应丢失旧路由；工具定义使用深拷贝。
ToolRegistry 发出定向变化事件，Gateway 增量同步注册并通知客户端工具列表变化。
