# Local Import Source UI（已移除）

桌面导入弹窗已移除本机配置源入口：

- “本机配置”标题、说明和“刷新检测”按钮。
- Cursor 全局配置、Claude Desktop 本地配置卡片。
- 打开弹窗时的自动检测、点击源预览及从源直接导入流程。

当前只保留粘贴 JSON、预览和导入，见 [MCP Config Import UI](27-mcp-config-import-ui.md)。
顶部 Claude / Cursor 格式说明也已移除，但 JSON 解析能力没有改变。

## 保留的 Core 能力

本轮仅移除桌面入口，没有删除 Core 本机配置源 API，也不会删除用户已有配置文件。
Core 仍可按固定 source id 读取文件并返回脱敏预览，接口见
[Local MCP Import Sources](28-local-import-sources.md)。

接口调用方在 source apply 时传入预览的 `modifiedAt`（字段名 `expectedModifiedAt`），
Core 会校验文件是否变化；该字段当前是可选的，未传入时不做此项比对。
