# Server Enable / Disable

MCP Gate 现在同时支持两层开关：

```text
Server enabled
└── Tool enabled
```

## Server disabled

当 Server 设置为 `enabled=false`：

1. 写入 Server Registry。
2. ManagementServer 立即调用 UpstreamManager.disconnect。
3. ToolRegistry 删除该 upstream 的 Tools。
4. Gateway 发布 `tools/list_changed`。
5. UI 禁止再次连接，直到 Server 被重新启用。

`autoStart` 的值不会因为禁用而丢失；重新启用后仍保留用户之前的启动策略。

## Tool disabled

Tool 级开关继续只影响单个 Tool，不会断开 upstream。
