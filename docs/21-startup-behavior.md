# Startup Behavior

MCP Gate 区分“用户手动启动”和“登录自启”。

## 手动启动

正常显示主窗口：

```text
open MCP Gate.app
→ main window visible
→ CoreSupervisor ensure_started
→ tray ready
```

## 登录自启

autostart plugin 使用：

```text
--hidden
```

因此：

```text
macOS login
→ LaunchAgent starts MCP Gate --hidden
→ CoreSupervisor ensure_started
→ tray ready
→ main window hidden
```

用户可以通过托盘“打开 MCP Gate”恢复窗口。

如果用户再次双击 App，single-instance callback 也会唤醒现有窗口，而不会创建第二个实例。
