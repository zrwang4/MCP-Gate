# Tauri Updater

当前版本暂不启用 Tauri Updater。

桌面端此前移除了 `tauri-plugin-updater`，当前 Release 流程只发布签名后的 macOS DMG 与 App ZIP。保留本文档用于后续恢复时的配置清单。

恢复 Updater 时，需要同时恢复：

- `tauri-plugin-updater` Rust 依赖与插件初始化
- `tauri.production.conf.json` 中的 updater 公钥与 `createUpdaterArtifacts`
- Release workflow 的 updater 签名密钥、`.app.tar.gz`、`.sig` 和 `latest.json`
- 桌面端检查更新/安装更新命令
- 对应的 release consistency check

不要只恢复其中任意一个部分，否则容易形成“配置声明启用、运行时未启用”的半配置状态。
