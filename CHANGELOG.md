# Changelog

## Unreleased

- Core 可在不设置 `MCP_GATE_FILESYSTEM_ROOT` 的情况下直接启动。
- 默认 Filesystem PoC 使用 `~/Library/Application Support/MCP Gate/filesystem`，启动时自动创建。


- 新增 MCP Server Registry，配置持久化到 `~/Library/Application Support/MCP Gate/servers.json`。
- 新增 stdio MCP 配置的创建、列表、删除 Management API。
- 桌面端“添加 MCP”按钮改为可用，支持保存名称、命令、参数和工作目录。
- Server Registry 使用原子文件替换与 0600 权限，损坏配置自动备份恢复。
- 新增 Server Registry 持久化和校验测试。


- 修复 Gateway 状态点 CSS 与运行状态类名不一致的问题。
- 修复日志面板自动滚动 ref 未绑定的问题。
- Desktop package 版本统一为 0.2.0。
- 恢复 macOS 稳定日志目录，不再依赖 Filesystem MCP root。
- 恢复共享的 MCP Server / 日志 / Core 状态类型。
- 删除误提交的 npm `package-lock.json`，项目继续统一使用 pnpm。


- 修复 MCP 子进程启动失败或 readiness 超时时长期停留在“启动中”的问题。
- 防止并发 start/stop/restart 操作互相覆盖。
- Core 版本改为从 package 元数据读取，统一 Desktop/Tauri 版本为 0.2.0。
- Core build 启用 TypeScript 相对扩展重写与 noEmitOnError。
- Core 退出前等待日志写入完成。
- 加强日志 Secret 脱敏，并增加 Node 内置测试。
- UI 在 Management API 断线时不再继续显示旧的“运行中”状态。
- UI 使用 Core 返回的实际 Gateway URL，支持非默认 Gateway 端口。
- 启用受限 Tauri CSP，仅允许必要的本地 IPC/Management API/HMR 连接。

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
