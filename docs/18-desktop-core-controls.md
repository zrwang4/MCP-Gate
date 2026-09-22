# Desktop Core Controls

React UI 现在通过 Tauri commands 读取 Rust CoreSupervisor 状态：

```text
core_runtime_status
restart_core
```

Gateway 面板显示：

- 桌面托管 Node
- 桌面托管 Sidecar
- 外部 Core
- 未运行
- 托管进程 PID

当 Management API 无法连接时，Tauri App 会显示“重启 Core”按钮。

普通 `pnpm desktop:web` 不存在 Tauri runtime，因此不会调用 IPC，UI 会显示“Web 模式”并继续使用原有 HTTP Management API。
