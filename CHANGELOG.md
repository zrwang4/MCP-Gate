# Changelog

## 0.2.0

- 新增本地 Management API（默认 `127.0.0.1:24889`）。
- 新增 MCP Server 状态、PID、启动时间和最近错误。
- 新增 Filesystem MCP 启动、停止、重启控制。
- 新增结构化 JSONL 日志和桌面日志面板。
- 新增 Info/Warn/Error/Debug 日志筛选。
- 新增基础 Secret 脱敏。
- 新增 5 MB 日志启动时滚动。
- Core 初始 MCP 启动失败时，Management API 保持可用，允许从 UI 重试。
- 新增 Management API smoke test。
- UI 增加 Gateway/Core/MCP 运行指标。
