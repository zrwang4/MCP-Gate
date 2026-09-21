# Single Instance

MCP Gate 使用 Tauri 官方 `single-instance` 插件保证桌面应用只有一个实例。

插件在 Builder 中最先注册，以避免其他插件先产生副作用。

当第二个实例启动时：

```text
second launch
   ↓
single-instance callback
   ↓
existing AppHandle
   ↓
show main window
unminimize
focus
```

不会再次创建系统托盘，也不会重复启动 CoreSupervisor。
