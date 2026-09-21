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

当前开关状态尚未持久化到磁盘；后续 ToolPolicy 持久化时再进入 SQLite。
