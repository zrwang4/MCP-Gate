# HTTP Authorization & macOS Keychain

HTTP MCP 可以配置完整的 `Authorization` Header 值，例如：

```text
Bearer ey...
```

Secret 不写入 `servers.json`。

Registry 仅保存：

```json
{
  "transport": "http",
  "url": "https://example.com/mcp",
  "authSecretId": "http-auth:<uuid>"
}
```

真实值存入 macOS Keychain，service：

```text
MCP Gate HTTP Authorization
```

Management API 对 UI 只暴露：

```json
{
  "hasAuthorization": true
}
```

不会返回 `authSecretId` 或 Authorization 内容。

HTTP Client 通过 SDK v2：

```ts
new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: {
      Authorization: secret
    }
  }
})
```

注入 Header。

## 更新策略

替换 Token：

```text
write new Keychain secret
→ update registry to new secret id
→ delete old Keychain secret
```

如果 Registry 更新失败，会删除刚创建的新 Secret，原 Secret 保持不变。
