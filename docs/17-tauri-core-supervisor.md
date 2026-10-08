# Tauri Core Supervisor

桌面端在 Tauri/Rust 层管理 Core 生命周期，开发态与安装版均支持。

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

启动优先级为：`MCP_GATE_CORE_EXECUTABLE` → App 捆绑的 Node + 编译后的 Core
→ 开发态系统 Node + TypeScript 源码。安装版不要求用户安装 Node。

如果设置 `MCP_GATE_CORE_EXECUTABLE`，supervisor 会直接启动该可执行文件。
默认生成管理 token，通过环境变量传给自己启动的 Core；UI 通过
`management_token` IPC 获取 token，再直接请求管理 HTTP API。

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
management_token
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

安装版使用 `Contents/MacOS/mcp-gate-node` 与
`Contents/Resources/core-runtime/dist/main.js`，详见
[Production Core Runtime Staging](19-production-core-runtime.md)。

当前 reachable 只检查管理端口是否能建立 TCP 连接，不代表已确认 MCP Gate 身份、
管理鉴权成功或网关已就绪。外部 Core 不会被接管，其 token 也不会被自动读取；
若与桌面 token 不一致，管理请求仍会失败。独立 Core 更新和自动回滚尚未实现。
