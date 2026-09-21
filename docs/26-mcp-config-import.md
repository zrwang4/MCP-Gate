# MCP Config Import

MCP Gate 支持粘贴 Claude Desktop / Cursor 风格的 MCP JSON 配置。

## Supported shape

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@example/filesystem"],
      "env": {
        "MODE": "production",
        "API_TOKEN": "secret"
      }
    },
    "remote": {
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer secret"
      }
    }
  }
}
```

也支持直接 server map：

```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@example/filesystem"]
  }
}
```

## Preview

`POST /api/import/mcp-config/preview`

Preview 不会返回 Secret 值，只显示：

- Server 名称与 transport
- command / args / URL
- 普通 env key
- Secret env key
- 是否存在 Authorization
- warnings / issues

## Apply

`POST /api/import/mcp-config/apply`

导入行为：

- stdio 普通 env → servers.json
- stdio 敏感 env → macOS Keychain
- HTTP Authorization → macOS Keychain
- 重复配置 → skipped
- 单项失败不回滚已成功导入的其它项

## Current limitations

暂不支持：

- Cursor `${...}` 配置插值
- `envFile`
- HTTP 非 Authorization 自定义 Header
- static OAuth `auth`
- 显式 legacy SSE transport

这些项会明确进入 issues，而不是静默丢失。
