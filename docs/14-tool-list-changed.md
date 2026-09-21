# Tool List Change Notifications

MCP Gate 的 ToolRegistry 现在会在公开工具集合发生实际变化时发出变更事件。

触发来源包括：

- upstream 首次连接并发现 Tools
- upstream `refresh-tools`
- upstream 断开 / Server 删除
- Tool enable / disable
- registry clear

GatewayServer 订阅该事件，并通过 MCP SDK v2 HTTP handler：

```ts
handler.notify.toolsChanged()
```

发布 `notifications/tools/list_changed`。

这样已经订阅列表变化的 Claude / Cursor / 其他 MCP Client 可以重新请求 `tools/list`，不必通过重启或重连才能看到最新 Tool 集合。

Registry 对 no-op 操作不会发送通知，例如重复禁用一个已经禁用的 Tool。
