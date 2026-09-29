# MCP Gate

轻量、macOS 优先的 MCP Gateway 桌面客户端。

当前 Core 已支持：

- 一个统一的 `http://127.0.0.1:24888/mcp`
- stdio 与 Streamable HTTP upstream
- 多 MCP Tool 聚合与 namespace 路由
- Tool 启用/禁用与持久化
- Tool 测试器
- MCP 自动连接
- HTTP Authorization → macOS Keychain
- Tauri 桌面端自动管理 Core 生命周期（开发态）
- Tauri Updater 通过 GitHub Release 检查、验签并安装稳定版更新

## Core 架构

Core 按“协议接入、业务编排、运行时、持久化”分层：

\`\`\`text
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
NaN核心职责边界：

- `UpstreamManager` 负责单个 upstream 的连接、断开、竞态保护、自动重连和运行态生命周期。
- `RuntimeReconciler` 负责批量目标集合与实际运行集合之间的 reconcile，Profile、启动恢复和配置变更统一经过这里。
- `ServerService` / `ProfileService` 负责业务事务编排，HTTP Route 不直接串联多层持久化和运行时操作。
- `MutationQueue` 串行化跨 Service 的配置变更，避免删除、Profile 切换、Tool Policy、Gateway Access 等操作互相覆盖。
- `ServerRegistry` / `ProfileStore` / `ToolPolicyStore` 的单文件 mutation 在持久化失败时恢复内存状态；底层文件通过原子替换和备份保护。
- `ToolRegistry` 发出定向变化事件，Gateway 对 Tool 做增量同步，不再每次全量重建全部 session 的 Tool 注册。

配置/运行时变更遵循：

\`\`\`text
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
NaN读取接口原则上不负责连接清理；`UpstreamManager.list()` 只读取当前 registry 配置并生成运行态快照，实际 orphan/disabled runtime 清理由显式 `reconcile()` 处理。

## 数据与安全边界

- `servers.json` 保存 MCP 配置和非敏感参数。
- `profiles.json` 保存 Profile 与 active Profile。
- `tool-policy.json` 保存 Tool 启用/禁用策略。
- HTTP Authorization 与 STDIO secret environment 值使用安全存储，不进入普通配置 JSON。
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

正式 DMG 阶段会把 `MCP_GATE_CORE_EXECUTABLE` 指向签名后的独立 Core sidecar，而不是依赖用户系统 Node。

## 本地数据

```text
~/Library/Application Support/MCP Gate/servers.json
~/Library/Application Support/MCP Gate/tool-policy.json
~/Library/Logs/MCP Gate/core.jsonl
```

HTTP MCP Authorization 不写入 JSON，而是存入 macOS Keychain。

## 发布与自动更新

- macOS 签名、公证与双架构发布：[docs/33-macos-signed-release.md](docs/33-macos-signed-release.md)
- Tauri Updater 与 GitHub Release 更新源：[docs/35-tauri-updater.md](docs/35-tauri-updater.md)
