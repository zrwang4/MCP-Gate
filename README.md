# MCP Gate

轻量、macOS 优先的 MCP Gateway 桌面客户端。

当前 Core 已支持：

- 一个统一的 `http://127.0.0.1:24888/mcp`
- stdio 与 Streamable HTTP upstream
- 多 MCP Tool 聚合与 namespace 路由
- Tool 启用/禁用与持久化
- Tool 测试器
- MCP 自动连接
- Gateway API Key、STDIO secret environment 与旧 HTTP authSecretId → macOS Keychain
- 自定义 HTTP headers（包括当前 UI 配置的 Authorization）保存于本机 JSON
- Tauri 桌面端自动管理 Core 生命周期（开发态及捆绑 Node/Core 的安装版）

## Core 架构

Core 按“协议接入、业务编排、运行时、持久化”分层：

```text
Desktop / Management API
        │
        ▼
Management Routes
        │
        ├── ServerService
        ├── ProfileService
        └── Import / Tool Policy / Gateway Access
                    │
                    ▼
             MutationQueue
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   RuntimeReconciler     Persistent Stores
          │              ├─ ServerRegistry
          │              ├─ ProfileStore
          │              └─ ToolPolicyStore
          ▼
    UpstreamManager
          │
     ┌────┴────┐
     ▼         ▼
   HTTP      STDIO
     │         │
     └────┬────┘
          ▼
      ToolRegistry
          │
          ▼
      GatewayServer
          │
          ▼
       MCP Proxy
```

核心职责边界：

- `UpstreamManager` 负责单个 upstream 的连接、断开、竞态保护、自动重连和运行态生命周期。
- `RuntimeReconciler` 负责批量目标集合与实际运行集合之间的 reconcile，Profile、启动恢复和配置变更统一经过这里。
- `ServerService` / `ProfileService` 负责业务事务编排，HTTP Route 不直接串联多层持久化和运行时操作。
- `MutationQueue` 串行化跨 Service 的配置变更，避免删除、Profile 切换、Tool Policy、Gateway Access 等操作互相覆盖。
- `ServerRegistry` / `ProfileStore` / `ToolPolicyStore` 的单文件 mutation 在持久化失败时恢复内存状态；底层文件通过原子替换和备份保护。
- `ToolRegistry` 发出定向变化事件，Gateway 对 Tool 做增量同步，不再每次全量重建全部 session 的 Tool 注册。

配置/运行时变更遵循：

```text
HTTP mutation
   ↓
Service
   ↓
MutationQueue
   ↓
Store change
   ↓
RuntimeReconciler
   ↓
UpstreamManager
   ↓
ToolRegistry
   ↓
Gateway tool update
```

读取接口原则上不负责连接清理；
`UpstreamManager.list()` 只读取当前 registry 配置并生成运行态快照，实际 orphan/disabled runtime 清理由显式 `reconcile()` 处理。

## 个人使用能力

MCP Gate 当前按个人长期使用场景收口，重点保留高频运维能力：

- MCP Server 增删改、连接/断开、自动重连、健康检查、熔断恢复与 Tool 刷新。
- Server 详情可查看连接状态、健康状态、熔断状态、工具数量、连续失败和最近运行日志。
- 支持 Profile 场景切换，以及 Tool 启用/禁用和测试。
- 支持配置备份与恢复。备份包含 Server、Profile、Tool Policy、Gateway Access 和会话生命周期配置，但不会导出 Keychain 中的 Secret 值。
- Gateway MCP Session 支持空闲自动过期，可在桌面端设置 5 分钟到 24 小时的生命周期；修改后自动重启 Core 生效。
- Core 日志与 Tool Audit 使用 JSONL 持久化，Core 重启后仍可查询历史记录。

配置备份适合在同一台 Mac 上恢复。由于 Secret 值保存在 macOS Keychain，跨机器恢复后需要重新配置缺失的 Secret。

## 数据与安全边界

- `servers.json` 保存 MCP 配置、普通环境变量、自定义 HTTP headers 和凭据引用。
- `profiles.json` 保存 Profile 与 active Profile。
- `tool-policy.json` 保存 Tool 启用/禁用策略。
- Gateway API Key、STDIO secret environment 和旧 HTTP `authSecretId` 对应的值使用 Keychain。
- 自定义 headers 可包含明文 Authorization 等凭据，配置文件应保持 `0600` 权限。
  备份导出会脱敏 Authorization/Proxy-Authorization/Cookie/Set-Cookie headers，
  恢复时删除 `[REDACTED]` 占位值；不保证识别任意自定义 header 或普通环境变量中的秘密。
- Core 日志和 Audit 日志对常见 Authorization、Token、Secret、Cookie 等敏感信息进行脱敏。

## 开发环境

- Node.js 22+
- pnpm 10.17.1
- Rust toolchain
- Tauri 2 所需系统依赖

安装：

```bash
corepack enable
pnpm install
```

## 启动桌面 App

```bash
pnpm desktop:dev
```

Tauri 启动时会检查 `127.0.0.1:24889`：

- 如果已有 Core 在运行，直接复用，不接管它。
- 如果没有 Core，桌面端自动启动 Node Core。
- App 退出时只终止自己启动的 Core。

当前检测仅确认 TCP 端口可达，不验证 Core 身份或管理鉴权；外部 Core 的
token 不会自动接管。UI 通过 Tauri IPC 获取桌面 token，再直接调用管理 HTTP API。

因此正常桌面开发不再需要额外执行 `pnpm core:dev`。

## 单独运行 Core

仍然可以：

```bash
pnpm core:dev
```

然后：

```bash
pnpm core:smoke
pnpm core:gateway-smoke
```

## Core 启动覆盖

Tauri supervisor 支持：

```text
MCP_GATE_CORE_EXECUTABLE
MCP_GATE_NODE_BINARY
MCP_GATE_CORE_ENTRY
```

开发态默认 Core entry：

```text
packages/core/src/main.ts
```

安装版已捆绑 Node sidecar 和编译后的 Core，不依赖用户系统 Node。
启动优先级为可执行文件覆盖 → 捆绑 Node/Core → 开发态 Node/源码，详见
[生产运行时打包](docs/19-production-core-runtime.md)。

独立 Core 下载、候选版本验证和自动回滚尚未实现，见
[Core 更新规划](docs/02-core-update.md)。本次架构审阅确认的熔断恢复过期任务、
Profile 激活失败回滚边界见 [架构与已知问题](docs/01-product-architecture.md)。

## 本地数据

```text
~/Library/Application Support/MCP Gate/servers.json
~/Library/Application Support/MCP Gate/profiles.json
~/Library/Application Support/MCP Gate/tool-policy.json
~/Library/Application Support/MCP Gate/gateway-access.json
~/Library/Application Support/MCP Gate/session-settings.json
~/Library/Logs/MCP Gate/core.jsonl
~/Library/Logs/MCP Gate/audit.jsonl
```

具体路径可通过 Core 配置覆盖。Keychain-backed 凭据不写入 JSON；自定义 HTTP
headers 是明文配置，两种路径需区分。写入有原子替换和轮转备份，但不是跨文件事务数据库。

## 发布

- macOS 签名、公证与双架构发布：[docs/33-macos-signed-release.md](docs/33-macos-signed-release.md)
- 当前版本暂不启用 Tauri Updater；Release 流程发布签名后的 DMG 与 App ZIP。
