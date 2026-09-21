# Changelog

## Unreleased

- 新增 GitHub Actions CI：自动运行 Core tests、全仓 typecheck 和 TypeScript/Web build。
- CI 固定 Node.js 22 与 pnpm 10.17.1；提交 pnpm-lock.yaml 后可切换 frozen lockfile 安装。


- 桌面端新增 Tool 测试器，可手工输入 JSON arguments 并查看调用结果。
- 新增 Management API `POST /api/tools/:publicName/call` 供本地调试使用。
- `core:gateway-smoke` 支持通过 `MCP_GATE_SMOKE_TOOL` 和 `MCP_GATE_SMOKE_ARGS` 显式执行端到端 `tools/call`。
- smoke 默认仍只执行 `tools/list`，避免自动触发有副作用的 Tool。


- Tool enable/disable 状态持久化到 `tool-policy.json`，Core 重启和 upstream 重连后继续生效。
- MCP Server 配置支持编辑 name/command/args/cwd；编辑时自动断开 upstream 并保持 alias 稳定。
- 删除 MCP 配置时同步清理对应 Tool policy。
- 新增 ToolPolicyStore 持久化测试。


- 修复并发开发合并后重复导入 `GatewayServer` 的构建错误。
- GatewayServer 新增运行状态 snapshot，Management API 可准确返回 Gateway 状态、Tool 数和最近错误。
- 显式添加 MCP SDK v2 所需的 `zod@4.6.5` peer dependency。


- MCP 配置新增自动连接开关，并持久化到 Server Registry。
- Core 启动 Gateway 后自动恢复所有 `enabled && autoStart` upstream。
- 单个自动连接失败只进入该 upstream 的 error 状态，不影响 Gateway 和其他 MCP。
- Management API 新增 `POST /api/server-configs/:id/settings`。
- 新增 Registry autoStart 持久化测试与 UpstreamManager 自动连接测试。


- 新增统一 Gateway 协议测试，使用 MCP SDK Client + InMemoryTransport 验证动态 `tools/list` 与 `tools/call`。
- 新增 `pnpm core:gateway-smoke`，通过真实 Streamable HTTP 连接 `/mcp` 并执行 `tools/list`。
- HTTP smoke 使用 SDK v2 version negotiation auto 模式，同时覆盖现代协议协商路径。


- 桌面端新增 Tools 管理区，可直接启用/禁用聚合 Tool。
- 新增 Tool enable/disable Management API；禁用 Tool 会立即从 Gateway `tools/list` 隐藏并拒绝调用。
- upstream 刷新 `tools/list` 时保留当前进程内的 Tool 开关状态。
- 清理桌面端旧 Filesystem PoC 控制视图，统一使用 Server Registry / UpstreamManager / ToolRegistry。
- Gateway Tool inputSchema 类型收紧到 MCP SDK `Tool["inputSchema"]`。


- 新增统一 GatewayServer，`127.0.0.1:24888/mcp` 直接聚合所有已连接 upstream Tools。
- Gateway 使用 MCP SDK v2 低层 `Server` 动态返回上游 JSON Schema。
- `tools/list` 读取内存 ToolRegistry；`tools/call` 通过 UpstreamManager 路由到原 MCP。
- 新 Gateway 同时支持 2026-07-28 与 SDK 默认的 stateless 2025-era HTTP 请求。
- 新增 `@modelcontextprotocol/server@2.0.0` 与 `@modelcontextprotocol/node@2.0.0`。
- 旧 Filesystem mcp-proxy PoC 不再占用主 Gateway 端口，但代码暂时保留作兼容/回退。


- stdio MCP connect 请求使用独立长超时，避免初始化超过 4 秒时 UI 误报失败。
- 修复 upstream `connecting` 状态被错误显示为“已停止”。


- 接入 MCP TypeScript SDK v2 客户端 `@modelcontextprotocol/client@2.0.0`。
- 新增真实 `StdioUpstreamClient`，通过 stdio 启动并初始化已保存 MCP Server。
- 已配置 MCP 支持连接、断开、刷新 Tools。
- 连接成功后自动执行 `tools/list` 并写入 ToolRegistry。
- Management API 新增 upstream connect/disconnect/refresh-tools 操作。


- 新增 ToolRegistry：显式维护 public tool → upstream/original tool 映射。
- Tool namespace 支持冲突规避，不依赖字符串 split 进行反向路由。
- 新增 UpstreamManager：管理 configured/connecting/running/error 状态、工具缓存和调用路由。
- 新增 `GET /api/upstreams` 与 `GET /api/tools` 调试接口。
- 新增 ToolRegistry / UpstreamManager 单元测试。


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
