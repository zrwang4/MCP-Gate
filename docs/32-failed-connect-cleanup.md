# Failed Connect Cleanup

Upstream client 在 `connect()` 完成握手前也可能已经创建底层资源：

- stdio 已 spawn 子进程
- HTTP 已建立请求或 session

因此 wrapper 必须在等待 `client.connect()` 前保存 client/transport 引用。

失败路径：

```text
stdio
client.connect fails
  → client.close()
  → SDK closes stdin
  → SIGTERM
  → SIGKILL fallback

HTTP
client.connect fails
  → terminateSession()
  → client.close()
```

这样 UpstreamManager 和保存前“测试连接”在失败时都不会因为 wrapper 尚未进入 connected 状态而跳过清理。
