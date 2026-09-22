# Connection Test Timeouts

保存前“测试连接”在 Core 侧有独立超时：

```text
connect      60s
tools/list   20s
```

超时不是只向 UI 返回错误。

Core 会同时调用临时 upstream 的 `disconnect()`，从而：

- stdio：关闭 transport 并回收子进程
- HTTP：结束 session / 请求并关闭 Client

因此即使 WebView 被关闭、fetch 被 abort，后台测试也不会无限挂起。

测试代码可以通过 `McpConnectionTestOptions` 注入更短超时。
