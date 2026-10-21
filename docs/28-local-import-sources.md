# Local MCP Import Sources

MCP Gate Core 可以直接发现并读取固定的本机 MCP 配置文件。
这是保留的管理 API 能力，当前桌面导入弹窗已移除本机源入口，不再自动检测或调用这些接口。
桌面入口现状见 [导入界面](27-mcp-config-import-ui.md)。

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

调用这些接口时，返回的源信息和预览包含：

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

所有接口都要求 `x-mcp-gate-client: desktop`；配置了管理 token 时，还需
`x-mcp-gate-token`，不是 Gateway API Key。鉴权见 [Management API Auth](28-management-auth.md)。

`source-preview` 请求体包含 `{ sourceId }`；`source-apply` 接受
`{ sourceId, expectedModifiedAt? }`。传入 `expectedModifiedAt` 时，文件修改时间
与预览不一致会拒绝导入，调用方应重新预览。
