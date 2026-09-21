# MCP Gate Starter

轻量中文 macOS MCP Gateway PoC，当前基于 `mcp-proxy` + Filesystem MCP。

## 当前能力（0.2.0）

- Streamable HTTP MCP：`http://127.0.0.1:24888/mcp`
- 健康检查：`http://127.0.0.1:24888/ping`
- 本地管理 API：`http://127.0.0.1:24889`
- Filesystem MCP 启动 / 停止 / 重启
- MCP PID、状态、启动时间、错误展示
- 结构化 Core 日志和 UI 日志面板
- 日志基础脱敏与 5 MB 启动时滚动
- 管理 API 只绑定 `127.0.0.1`

## 启动

```bash
corepack enable
pnpm install
mkdir -p "$HOME/Desktop/mcp-gate-test"

MCP_GATE_FILESYSTEM_ROOT="$HOME/Desktop/mcp-gate-test" \
pnpm core:dev
```

另一个终端运行 Web UI：

```bash
pnpm desktop:web
```

健康检查：

```bash
pnpm core:smoke
pnpm core:management-smoke
```

日志默认位置：

```text
~/Library/Logs/MCP Gate/core.jsonl
```

## 当前架构边界

0.2.0 的 MCP 管理只控制 Filesystem PoC。新增任意 MCP、多 Server 聚合、统一 tools/list 与 tools/call 路由将在 MG-006～MG-011 中实现，不会采用“一台 MCP 一个 proxy 端口”的临时架构。

详见 `docs/`。
