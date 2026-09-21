# Local Import Source UI

导入配置弹窗会检测固定的本机 MCP 配置源。

当前显示：

```text
Cursor 全局配置
~/.cursor/mcp.json

Claude Desktop 本地配置
~/Library/Application Support/Claude/claude_desktop_config.json
```

存在的配置可以直接点击“预览”。

## Data flow

```text
WebView
  │ source id only
  ▼
Core reads local file
  │
  ├─ parse
  ├─ classify secrets
  └─ redact
       │
       ▼
WebView receives preview only
```

原始 JSON 不从 Core 返回给 WebView。

Source apply 会带上 preview 时的 `modifiedAt`。如果文件被外部程序更新，Core 拒绝 apply，要求重新 preview。
