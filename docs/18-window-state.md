# Window State

MCP Gate 使用 Tauri 官方 `window-state` plugin 保存桌面窗口状态。

当前由 Rust shell 初始化：

```rust
tauri_plugin_window_state::Builder::default().build()
```

插件会在应用退出时保存窗口状态，并在下一次启动时恢复。

当前主要依赖的状态：

- 窗口位置
- 窗口尺寸
- 最大化状态

前端不直接调用 window-state plugin，因此不需要为 WebView 开放对应 command permissions。
