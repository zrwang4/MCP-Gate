# macOS Release Preview

仓库新增手动触发的 GitHub Actions workflow：

```text
.github/workflows/release-preview.yml
```

用途是验证“真正可打包的 macOS App”，而不只是 TypeScript / Rust 编译通过。

## Build

workflow 执行：

```bash
pnpm install --no-frozen-lockfile
pnpm desktop:bundle
```

其中 `desktop:bundle` 会先 staging：

- 固定 Node runtime sidecar
- Core production dist
- Core production node_modules

再执行 Tauri production build。

## Bundle verification

构建后会检查：

```text
MCP Gate.app/
├── Contents/MacOS/mcp-gate
├── Contents/MacOS/mcp-gate-node
└── Contents/Resources/core-runtime/
    ├── dist/main.js
    └── node_modules/
```

同时要求生成 DMG。

## Artifacts

成功后上传：

```text
mcp-gate-macos-app
mcp-gate-macos-dmg
```

保留 7 天。

## 当前边界

Release Preview 暂时不包含：

- Developer ID Application 签名
- hardened runtime / entitlements 最终确认
- Apple notarization
- stapling
- universal binary

这些会在正式 Release workflow 中接入。
