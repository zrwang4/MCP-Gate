# Tray & Autostart

MCP Gate 的 Tauri shell 现在提供桌面常驻能力。

## 系统托盘

托盘菜单：

```text
打开 MCP Gate
重启 Core
退出 MCP Gate
```

关闭主窗口时不会退出应用，而是隐藏窗口；Core 和 Gateway 继续运行。

真正退出时，Tauri 的 `RunEvent::Exit` 会继续执行 CoreSupervisor 的 owned-process cleanup。

## 登录时自动启动

使用官方 `tauri-plugin-autostart`，macOS launcher 为：

```text
LaunchAgent
```

前端不直接调用 autostart plugin，而是通过 MCP Gate 自己的 commands：

```text
autostart_enabled
set_autostart
```

这样无需向 WebView 开放插件 command permissions。
