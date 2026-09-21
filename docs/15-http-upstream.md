# HTTP MCP Upstream

MCP Gate 现在支持两种 upstream：

```text
stdio
http
```

HTTP upstream 使用 MCP SDK v2：

```ts
new StreamableHTTPClientTransport(new URL(url))
```

并由 Client 的 version negotiation auto 模式完成协议协商。

## 配置

示例：

```json
{
  "name": "Remote MCP",
  "transport": "http",
  "url": "https://example.com/mcp"
}
```

只接受 `http:` / `https:` URL。

## 鉴权边界

当前 Registry 不持久化 Authorization 或任意自定义 Header，以避免 Secret 明文进入 `servers.json`。

后续 Keychain 阶段会增加 Secret 引用，再通过 `StreamableHTTPClientTransport({ requestInit: { headers } })` 注入请求头。
