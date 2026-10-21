# MCP Config Import UI

MCP 管理区提供“导入配置”。

当前弹窗只提供 JSON 粘贴导入：

- 不再显示“本机配置”检测区、Cursor / Claude 配置卡片和“刷新检测”按钮。
- 不再显示顶部“支持 Claude / Cursor 风格 mcpServers JSON”说明；底层解析格式不变。
- 打开弹窗不再请求本机配置源，也不再提供 source preview / source apply 的界面入口。
- 已移除“或粘贴 JSON”分隔行，直接显示“JSON 配置”输入框。

Core 的本机配置源接口仍保留，见 [本机配置源 API](28-local-import-sources.md)；
这不代表桌面界面仍会自动读取这些文件。

流程：

```text
粘贴 JSON
   ↓
预览
   ↓
显示可导入 Server / Keychain key / issues
   ↓
导入
   ↓
刷新 MCP 列表
```

预览区不会把 Secret 值再次渲染出来。
输入内容变更后清空旧预览和导入结果，需要重新预览。

对应接口：

```text
POST /api/import/mcp-config/preview  { config }
POST /api/import/mcp-config/apply    { config }
```

批量导入可能部分成功：

- imported：成功创建
- skipped：相同配置已存在
- failed：Registry / Keychain 写入失败
- issues：配置本身当前不支持

当存在 failed 或 issues 时，弹窗保留导入结果，用户可以直接修正 JSON 后重新预览。
