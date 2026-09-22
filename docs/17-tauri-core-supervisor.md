# Tauri Core Supervisor

桌面端现在在 Tauri/Rust 层管理 Core 生命周期。

## 启动

App setup 时：

```text
检查 127.0.0.1:24889
        │
        ├─ 已可连接 → 视为 external Core，只复用
        │
        └─ 不可连接 → 启动 managed Core
```

开发态默认执行：

```text
node --experimental-strip-types packages/core/src/main.ts
```

可以覆盖：

```text
MCP_GATE_NODE_BINARY
MCP_GATE_CORE_ENTRY
MCP_GATE_CORE_EXECUTABLE
```

如果设置 `MCP_GATE_CORE_EXECUTABLE`，supervisor 会直接启动该可执行文件。这个入口用于后续打包独立、签名后的 Core sidecar。

## 退出

Tauri 收到 `RunEvent::Exit` 时：

- 只有 supervisor 自己持有的 child 才会被停止。
- Unix/macOS 先发送 SIGTERM。
- 等待约 2.5 秒后仍未退出才强制 kill。
- external Core 不会被终止。

## Commands

```text
core_runtime_status
restart_core
```

status 返回：

```json
{
  "reachable": true,
  "managed": true,
  "pid": 12345,
  "launchMode": "managed-node"
}
```

## Production boundary

当前自动启动解决的是开发态桌面体验。

正式 DMG 仍需要：

```text
signed app
  └─ signed Core sidecar executable
```

并通过 `MCP_GATE_CORE_EXECUTABLE` / 最终固定 sidecar path 启动，不要求用户安装 Node.js。
