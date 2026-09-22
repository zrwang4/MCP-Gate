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
