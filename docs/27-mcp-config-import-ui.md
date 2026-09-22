# MCP Config Import UI

MCP 管理区提供“导入配置”。

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

批量导入可能部分成功：

- imported：成功创建
- skipped：相同配置已存在
- failed：Registry / Keychain 写入失败
- issues：配置本身当前不支持

当存在 failed 或 issues 时，弹窗保留导入结果，用户可以直接修正 JSON 后重新预览。
