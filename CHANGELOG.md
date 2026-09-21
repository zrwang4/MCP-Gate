# Changelog

## Unreleased

- 修复 `release:check` 在普通 branch CI 中误把 `GITHUB_REF_NAME=main` 当作发布 tag；现在仅在 `GITHUB_REF_TYPE=tag` 或显式 `RELEASE_TAG` 时校验 tag。


- 新增正式 macOS Release workflow：仅由 `vX.Y.Z` tag 触发，执行 tests/typecheck/build、Developer ID 签名、Apple notarization、stapling 验证并创建 draft GitHub Release。
- Release 构建前强制校验 Root/Desktop/Core/Tauri/Cargo 版本一致，并要求 tag 与应用版本一致。
- 正式发布要求 GitHub Secrets：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`、`KEYCHAIN_PASSWORD`。
- 发布产物统一生成版本化 DMG、App ZIP 和 `SHA256SUMS.txt`，同时上传 Actions artifact。
- CI 新增 release metadata consistency 检查，防止多处版本漂移。
- GitHub Actions checkout/setup-node 更新到当前 Tauri 官方 pipeline 文档使用的主版本，消除旧 Node runtime deprecation 警告。
- unsigned Release Preview workflow 保留，用于无 Apple 发布凭据时的日常 bundle 验证。


- 新增安全 LAN 模式，默认关闭；仅当 Gateway API Key 已启用且可从 Keychain 读取时允许开启。
- LAN 模式仅把公开 MCP Gateway 从 localhost 热重绑到 IPv4 `0.0.0.0`；Management API 始终保持 `127.0.0.1:24889`。
- LAN 请求继续使用 MCP SDK v2 `hostHeaderValidation` / `originValidation`，allowlist 自动包含 localhost、机器 hostname 和当前非 internal IPv4，保留 DNS rebinding 防护。
- 关闭 Gateway API Key 时若 LAN 正在运行，会自动退回 localhost，避免无认证暴露。
- Keychain API Key 丢失时启动阶段自动关闭持久化 LAN 设置；公开 Gateway fail-safe 回到 localhost。
- Management API 新增 `POST /api/gateway-access/lan`，切换时只重启 Gateway listener，不重启整个 Core。
- Gateway status / 诊断快照新增 `lanEnabled` 和可连接的 `lanEndpoints`。
- 桌面设置新增局域网访问开关和 LAN endpoint 展示。
- 新增 LAN 必须依赖 API Key、持久化和缺失 Secret 自动关闭测试。


- 运行日志新增关键字搜索、source 筛选和等级组合筛选。
- 日志工具栏显示“命中数 / 当前缓存数”，并支持一键复制当前筛选结果。
- 桌面端每次读取最近 500 条内存日志，面板最多渲染最后 120 条命中记录，避免长列表拖慢 UI。
- 搜索匹配 message、source 和 level；日志 JSONL 格式和 Core Logger 无需迁移。


- 修复 AuditLogger options 误传给 GatewayAccessController、未传给 UpstreamManager 的接线错误。


- 新增独立 Tool 调用审计日志 `~/Library/Logs/MCP Gate/audit.jsonl`，与 Core 运行日志分离。
- 审计只记录 public Tool、upstream 路由、调用来源、耗时、成功/失败和脱敏后的错误，不记录 arguments 或 result。
- 正常 MCP 客户端调用标记为 `gateway`，桌面 Tool 测试器调用标记为 `tester`。
- 新增受 Management Token 保护的 `GET /api/audit`，支持 after/limit/success/source 过滤。
- 桌面端新增 Tool 调用审计面板，显示最近调用与耗时。
- Audit JSONL 启动时达到约 5 MB 会滚动为 `audit.jsonl.1`，Core 退出前 flush。
- 新增审计最小化数据与错误 Secret 脱敏测试。


- 修复 connection-test 单测调用新 options 签名时漏改的一处 factory 参数，恢复 Core strict typecheck。


- 连接测试 timeout timer 不再 `unref()`，确保即使被测试操作本身不占用事件循环，Core 也会等待硬超时并执行主动断开。
- 修复 timeout 单元测试在 Node test runner 中被 `cancelledByParent` 的问题。


- 保存前连接测试新增 Core 侧硬超时：connect 默认 60 秒，tools/list 默认 20 秒。
- 超时后 Core 主动 disconnect 临时 client，不依赖 WebView 的 fetch abort 来回收 stdio 子进程或 HTTP session。
- 新增可注入超时配置用于单元测试，并覆盖 connect 永久挂起时的主动断开路径。


- 统一 `/mcp` 新增可选 Gateway API Key，默认关闭；开启后要求 `Authorization: Bearer <key>`。
- API Key 明文只在启用/轮换时返回一次，持久化仅保存 Keychain opaque Secret ID。
- Gateway Access 配置存放于 `gateway-access.json`；Keychain Secret 缺失时 fail closed，`/mcp` 返回 503 而不是静默放开。
- Management API 新增 `GET /api/gateway-access`、`POST /rotate`、`POST /disable`。
- 桌面设置支持启用、轮换、关闭 Gateway API Key；新 Key 自动复制并只在当前 UI 会话显示。
- Gateway status / 诊断快照新增 authRequired/authReady/authError。
- 新增 Gateway access Keychain 持久化、Bearer 验证与 fail-closed 测试。


- 修复 upstream 初始化失败时的 transport 清理：stdio/HTTP client 在 connect 前记录生命周期引用，失败后显式 close。
- stdio connect 失败会调用 Client.close，确保 SDK 按 stdin → SIGTERM → SIGKILL 顺序回收子进程。
- HTTP connect 失败会先 terminateSession，再 close Client；无 session 时 terminateSession 安全返回。
- 简化保存前连接测试的 finally，统一调用 disconnect 做 best-effort 清理。


- MCP 添加/编辑弹窗新增“测试连接”，保存前可验证 stdio/HTTP 的 initialize + tools/list。
- 测试成功显示 Tool 数量、耗时和最多 12 个 Tool 名称；失败信息只显示在弹窗内，不覆盖当前已保存配置。
- 编辑已有 stdio/HTTP 时继续支持留空复用 Keychain Secret，测试不会写入 Registry 或替换 Secret。
- 测试是可选操作，不强制通过后才能保存。


- 修复诊断快照联合类型与 Gateway snapshot 类型依赖导致的 Core typecheck 失败。


- 新增 MCP 保存前连接测试服务：使用内存配置完成 connect + tools/list + disconnect，不写入 Server Registry。
- 编辑 stdio MCP 时，Secret 输入留空可复用现有 Keychain 值进行测试；新 Secret 仍必须提供值。
- 编辑 HTTP MCP 时，Authorization 留空可复用现有 Keychain 值；勾选清除时按无鉴权测试。
- 新增 `POST /api/server-configs/test-connection`，成功返回 transport、Tool 数量、最多 50 个 Tool 名称和耗时。
- 测试日志只记录 transport、Tool 数和耗时，不记录 command、URL、env 或 Secret。
- 新增 stdio Secret 复用、HTTP Authorization 复用和缺失新 Secret 的单元测试。


- 新增受 Management Token 保护的 `GET /api/diagnostics`，生成结构化诊断快照。
- 诊断快照包含 Core/Gateway、Profiles、MCP 状态、Tools 和最近 warn/error 日志。
- 默认不导出 Keychain Secret、Secret ID、普通 env 值或完整 stdio args。
- HTTP URL 会移除 username/password/query/hash，Home 路径缩写为 `~`，日志再次执行 Secret 脱敏。
- 桌面设置新增“一键复制诊断信息”，方便用户提交支持信息。
- 新增诊断 stdio / HTTP 脱敏测试。


- 补充 Vite `import.meta.env` 类型声明，修复 Management API session-token 前端代码在 strict typecheck 下的 TS2339。
- 保留桌面 Tauri command 获取 token 与 Web 开发模式 `VITE_MCP_GATE_MANAGEMENT_TOKEN` 两种路径。


- 修复 Desktop typecheck 缺少 Vite ImportMetaEnv 类型导致的 `import.meta.env` 编译错误。


- 导入弹窗新增本机配置自动发现，可直接预览并导入 Cursor 全局配置和 Claude Desktop 本地配置。
- 本机 Source 模式不把原始 JSON 或 Secret 值传给 WebView；UI 只显示固定的 ~ 路径、存在状态和脱敏 Preview。
- Source Preview 与 Apply 增加 modifiedAt 一致性校验；文件在预览后发生变化时拒绝导入并要求重新预览。
- 仍保留手工粘贴 JSON 模式，可在同一弹窗中切换使用。


- 正式桌面模式新增 Management API 随机会话 Token，替代仅依赖固定 `X-MCP-Gate-Client` 的弱控制面边界。
- Tauri 每次启动生成 64 字符随机 Token，通过 `MCP_GATE_MANAGEMENT_TOKEN` 只注入自己托管的 Core。
- 前端通过 Tauri command 获取当前 Token，并在所有 Management API 请求发送 `X-MCP-Gate-Token`。
- 除 `/api/health` 外，所有 Management API（包括读取日志、配置、Tools、Profiles）都要求认证。
- Token 使用 timing-safe compare；认证失败不记录 Token 内容。
- 手工开发 Core 未设置 Token 时保留旧 desktop header fallback；可通过 `MCP_GATE_MANAGEMENT_TOKEN` + `VITE_MCP_GATE_MANAGEMENT_TOKEN` 显式启用开发 Token。
- 新增 Management auth 单元测试并更新 management smoke。


- 新增本机 MCP 配置源发现：Cursor 全局 `~/.cursor/mcp.json` 与 Claude Desktop macOS 本地配置。
- Core 直接读取固定配置路径，WebView 只拿到存在状态、脱敏 Preview 和导入结果，不接收原始配置文件或 Secret 值。
- 新增 `POST /api/import/mcp-config/sources`、`source-preview`、`source-apply`。
- 配置源读取限制为 512 KiB，只接受普通文件和合法 JSON。
- Source API 只返回 `displayPath`（~ 路径），不暴露真实 Home 绝对路径。
- 新增配置源路径解析、存在性检测、读取与路径脱敏测试。


- 桌面端 MCP 管理新增“导入配置”入口，支持粘贴 Claude/Cursor 风格 JSON。
- 导入采用“粘贴 → 预览 → 应用”两阶段流程，预览列表显示 transport、启动目标、普通 env key、Keychain key 和 warnings。
- 预览区不回显 Secret 值；不支持项逐条显示 issue，不会阻止其它合法 Server 预览。
- 批量导入支持 imported/skipped/failed 结果；全部成功时自动关闭弹窗并刷新 MCP 列表，部分失败时保留结果供排查。


- 新增 Claude/Cursor 风格 MCP JSON 导入解析，支持顶层 `mcpServers` 与直接 server map。
- 新增 `POST /api/import/mcp-config/preview`：只返回可导入项、Secret key 和问题，不回显 Secret 值。
- 新增 `POST /api/import/mcp-config/apply`：批量写入 Server Registry，并把敏感 env / HTTP Authorization 保存到 Keychain。
- 导入时按环境变量名称识别常见 Token/Key/Secret/Password 等敏感项；普通 env 仍保存在 servers.json。
- HTTP 导入当前只接受 Authorization Header；其它自定义 Header、static OAuth、legacy SSE type 会明确报不支持，不静默丢弃。
- Cursor 配置插值（如 `${env:NAME}`、`${workspaceFolder}`）当前明确拒绝，避免导入后作为错误字面量传给 MCP。
- 重复导入同名且同启动目标的配置会跳过，不创建重复 Server。
- 新增导入预览脱敏、非法 Header/插值和 Keychain 持久化测试。


- Gateway 概览新增 Profile 快捷切换，下拉可直接激活目标 Profile。
- 顶部指标显示当前 Profile；无 active Profile 时明确显示“手动模式”。
- 选择“手动模式（无 Profile）”会停用当前 Profile，并保留各 Server 的 autoStart 配置不变。


- 编辑当前 active Profile 后立即执行 exact-set reconcile，运行集合与刚保存的成员保持一致。
- 删除当前 active Profile 前先停用其成员，再清空 activeProfileId，避免删除配置后旧成员继续运行。
- Profile 编辑器新增“使用当前运行集合”“全选已启用”“清空”快捷操作。
- active Profile 编辑/删除出现部分失败时，Management API 返回 reconcile 结果并在桌面端提示。


- 桌面端新增 Profiles 管理区：创建、编辑、删除、激活、停用 Profile。
- Profile 编辑器用复选框选择 MCP 成员，并显示禁用状态。
- Profile 卡片显示当前 active 状态、成员运行数和各成员运行状态。
- 激活操作显示部分失败信息；空 Profile 可作为“一键断开全部 MCP”的场景。
- 前端轮询同步 activeProfileId，Core 重启恢复后 UI 会自动显示当前 Profile。


- 新增 Profiles 持久化到 `~/Library/Application Support/MCP Gate/profiles.json`。
- Profile 保存一组 MCP Server ID；激活 Profile 会把运行集合精确切换到该组，停用会断开该组成员。
- 当前 active Profile 持久化；Core 重启时优先恢复 active Profile，没有 active Profile 时才执行各 Server 的 autoStart。
- Management API 新增 Profile CRUD、activate/deactivate。
- 删除 MCP Server 时自动从所有 Profile 移除，删除 active Profile 会清空 activeProfileId。
- UpstreamManager 新增 applyExactSet / disconnectSet，并返回 connected/disconnected/failed 结果。
- 新增 ProfileStore 持久化测试与 Profile 运行集合切换测试。


- 修复 stdio env Management API 缺少环境变量校验 helper 导致的 typecheck / production staging 失败。
- stdio Server 的 Management API 响应不再暴露 opaque envSecretIds，只返回 secretEnvKeys。
- stdio → HTTP transport 切换时同步清理旧的 Secret env Keychain 项。


- stdio MCP 新增环境变量配置；普通变量写入 servers.json，Secret 变量只保存 opaque Keychain 引用。
- 新增 `POST /api/server-configs/:id/environment`，独立管理 stdio env 与 Secret env。
- Secret env 编辑时 `KEY=` 表示保留已有 Keychain 值，删除整行表示删除对应 Secret。
- StdioUpstreamClient 连接前从 SecretStore 解析 Secret env，再交给 MCP SDK stdio transport；SDK 会继续合并 HOME/PATH/SHELL 等安全默认环境。
- stdio → HTTP 切换或删除 Server 时自动清理对应 Secret env Keychain 项。
- 桌面端添加普通/Secret 环境变量编辑区，并显示每个 stdio MCP 的环境变量数量。
- 新增 Registry 环境元数据持久化测试与 stdio Secret env 解析测试。


- 新增 Upstream 意外断线检测：MCP SDK Client 的 onclose/onerror 生命周期接入 UpstreamManager。
- 已成功运行的 MCP 意外断线后自动从 ToolRegistry 移除 Tools，避免继续暴露失效工具。
- 自动重连采用 1s → 2s → 5s → 10s → 30s 退避；重连成功后恢复 Tools 并重置计数。
- 手动断开、Server 禁用、Core shutdown 不触发自动重连；首次连接失败也保持显式失败，不进入无限重试。
- Management API / UI 暴露 reconnectAttempt 与 nextRetryAt，桌面端显示下一次自动重连状态。
- 新增意外断线恢复与手动断开不重连测试。


- 桌面端新增 MCP Server 级启用/禁用开关。
- 禁用 Server 时 Core 立即断开 upstream，并从 ToolRegistry 移除对应 Tools。
- 禁用 Server 后禁止“连接”和修改 autoStart；重新启用后保留原 autoStart 配置。
- Server Registry 测试覆盖 enabled + autoStart 的持久化。


- 修复 production runtime 的 .gitignore 规则被误写为字面量 `\\n`，确保 Node sidecar 与 staged Core resources 不会被误提交。


- macOS 登录自启改为静默模式：LaunchAgent 传入 `--hidden`，启动后仅驻留托盘，不弹主窗口。
- 用户手动启动仍正常显示窗口；托盘“打开”或第二实例会重新 show/unminimize/focus。
- Tray 增加 macOS 菜单栏标题 `MCP`，在正式图标落地前确保托盘入口可见。


- 新增手动触发的 macOS Release Preview workflow，实际构建 Tauri production bundle。
- Release Preview 验证 .app 内包含 MCP Gate、Node sidecar、Core dist 与 production node_modules。
- 构建成功后上传 .app 和 .dmg artifact，保留 7 天供测试。
- Preview 当前为 unsigned 构建；Developer ID 签名与 notarization 留到正式发布阶段。


- 修复 sidecar staging 提交时 package.json 结尾误写字面量 `\\n` 导致 pnpm 无法解析的问题。
- 清理 production Core runtime 文档中的内部检索引用标记。


- Tauri 桌面端新增 window-state plugin，自动保存并恢复主窗口位置和尺寸。
- Window state 完全在 Rust 侧启用，不向 WebView 开放额外插件权限。
- 桌面设置区展示窗口状态持久化能力。


- 新增 production Core runtime staging：复制固定 Node runtime 为 Tauri target-triple sidecar，并通过 `pnpm deploy --prod --legacy` 生成自包含 Core resources。
- 新增 `tauri.production.conf.json`：打包 `mcp-gate-node` external binary 与 `core-runtime` resources。
- CoreSupervisor 在正式 App 中自动发现 `Contents/MacOS/mcp-gate-node` 与资源目录的 `core-runtime/dist/main.js`，优先使用内置 runtime。
- 新增 `pnpm desktop:sidecar:prepare` 与 `pnpm desktop:bundle`。
- macOS CI 现在实际 staging Node/Core runtime，再执行 Rust check。
- 生成的 Node sidecar 和 Core runtime 目录加入 gitignore，不提交大型二进制。


- Tauri 桌面端新增 single-instance 插件，防止登录自启后用户再次双击产生重复实例。
- single-instance 按官方建议作为首个插件注册。
- 第二实例启动时自动显示、取消最小化并聚焦已有主窗口。
- 桌面设置区展示单实例保护状态。


- macOS 桌面端新增系统托盘：可打开 MCP Gate、重启 Core、退出应用。
- 主窗口关闭行为改为隐藏到托盘，后台 Gateway/Core 保持运行。
- 新增 Tauri autostart plugin，支持 macOS LaunchAgent 登录时自动启动。
- 前端通过自有 Tauri command 读取/切换 autostart，不直接暴露插件 JS 权限。
- 桌面设置区新增“登录时自动启动”和托盘状态。


- 补充临时 Tauri `icons/icon.png`，解除 `generate_context!()` 在 Rust CI 中对默认图标的硬依赖。
- pnpm 显式允许 `@github/keytar` install script，确保 macOS Keychain native prebuild 正常安装。
- CoreSupervisor 启动 Node Core 时工作目录修正为 monorepo root。


- 显式设置 Tauri bundle icon 为空数组，避免尚未提交正式 App 图标时 `cargo check` 读取不存在的默认 `icons/icon.png`。


- 桌面 UI 显示 CoreSupervisor 状态：桌面托管 Node、托管 Sidecar、外部 Core 或未运行。
- Management API 连接失败时，Tauri 模式可直接点击“重启 Core”调用 Rust supervisor。
- Gateway 指标新增托管 Core PID，Web-only 模式保持兼容。


- Tauri 桌面端新增 CoreSupervisor：启动时自动检测并拉起 Core，退出时只回收自己启动的 Core。
- 已存在的外部 Core 会被复用，不会被桌面端误杀。
- 新增 `core_runtime_status` 与 `restart_core` Tauri command。
- CoreSupervisor 开发态默认启动 `packages/core/src/main.ts`，并支持 `MCP_GATE_CORE_EXECUTABLE` 为后续独立 sidecar 预留入口。
- README 更新为当前统一 Gateway / stdio+HTTP / Keychain / 自动 Core 生命周期架构。


- HTTP MCP 新增 Authorization 鉴权，Secret 通过 `@github/keytar` 写入 macOS Keychain。
- `servers.json` 只保存 opaque `authSecretId`，Management API 只返回 `hasAuthorization`，不会返回 secret id 或 Token。
- HTTP transport 连接时从 Keychain 读取 Authorization，并通过 MCP SDK `requestInit.headers.Authorization` 注入。
- 编辑 HTTP MCP 支持替换或清除 Authorization；采用“新 Secret 先写入、配置成功后删除旧 Secret”的更新顺序。
- 删除 HTTP MCP 配置时同步删除对应 Keychain Secret。
- 新增 SecretStore 抽象和 MemorySecretStore 测试；`@github/keytar` 为 macOS optional dependency。


- 修复编辑 MCP 配置时 HTTP 与 stdio 之间切换 transport 未正确写入的问题。


- 新增 HTTP MCP upstream：Server Registry 支持 `transport: "http"` 与远端 MCP URL。
- 新增 `HttpUpstreamClient`，使用 MCP SDK v2 `StreamableHTTPClientTransport` 和自动协议协商。
- stdio / HTTP upstream 共用 UpstreamManager、ToolRegistry、统一 `/mcp` 与 autoStart 生命周期。
- 桌面端添加/编辑 MCP 可选择“本地命令（stdio）”或“远端 MCP（HTTP）”。
- HTTP 配置当前只持久化 URL，不保存 Authorization/Header secret；鉴权留给 Keychain 阶段。
- 新增 HTTP Registry URL 校验测试。


- ToolRegistry 新增变更事件；upstream Tools、Tool 开关或 Server 移除时只在实际列表变化时触发。
- GatewayServer 订阅 ToolRegistry 变化，并通过 `handler.notify.toolsChanged()` 向已订阅客户端发布 `notifications/tools/list_changed`。
- Gateway 停止时自动取消 ToolRegistry 订阅，避免重复通知和泄漏。
- 新增 ToolRegistry change event 单元测试。


- 修复 UpstreamManager test fake client 返回值不符合 MCP SDK v2 `CallToolResult` 类型导致的 typecheck 失败。


- 修复 UpstreamManager 测试 teardown 与异步日志写入的竞争，删除临时目录前先 flush logger。


- 恢复可测试的 `createGatewayProtocolServer` 工厂，并让 HTTP GatewayServer 复用同一协议构造逻辑。
- 修复 CI 中 gateway protocol test 因重构后导出缺失导致的失败。


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
