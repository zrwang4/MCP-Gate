# Upstream Recovery

MCP Gate 现在监听 MCP SDK Client 的连接生命周期：

```text
Client.onerror
Client.onclose
```

stdio 子进程退出、管道关闭，以及 HTTP transport 最终关闭时都能反馈给 UpstreamManager。

## 策略

只有“曾经成功进入 running，随后意外断线”的 upstream 会自动重连。

不会自动重连：

- 用户手动点击断开
- Server 被禁用
- Core 正常 shutdown
- 第一次手动/autoStart 连接就失败

这样可以避免错误配置进入无限后台重试。

## Backoff

```text
1s
2s
5s
10s
30s
30s
...
```

意外断线时：

```text
running
  ↓ onclose
error
  ↓ remove server tools
tools/list_changed
  ↓ backoff
connecting
  ↓ initialize + tools/list
running
```

重连成功后 retry counter 清零。

## UI / Management

Upstream snapshot 新增：

```json
{
  "reconnectAttempt": 1,
  "nextRetryAt": "2026-09-21T09:10:00.000Z"
}
```

桌面端会显示下一次自动重连的尝试序号和时间。
