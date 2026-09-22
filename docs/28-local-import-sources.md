# Local MCP Import Sources

MCP Gate Core 可以直接发现并读取固定的本机 MCP 配置文件。

## Sources

macOS 当前支持：

```text
Cursor
~/.cursor/mcp.json

Claude Desktop
~/Library/Application Support/Claude/claude_desktop_config.json
```

## Security boundary

原始配置文件由 Core 读取。

WebView 只会收到：

- source id / label
- displayPath（~ 形式）
- exists / size / modifiedAt
- 脱敏后的 import preview
- apply result

不会返回：

- 真实 Home 绝对路径
- 原始 JSON
- env Secret 值
- Authorization 值

## API

```text
POST /api/import/mcp-config/sources
POST /api/import/mcp-config/source-preview
POST /api/import/mcp-config/source-apply
```

所有接口都要求 Desktop Client header。
