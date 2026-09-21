# Production Core Runtime Staging

正式 macOS App 不要求用户安装 Node.js。

当前生产打包采用：

```text
MCP Gate.app
├── Contents/MacOS/
│   ├── mcp-gate
│   └── mcp-gate-node
└── Contents/Resources/
    └── core-runtime/
        ├── dist/
        ├── package.json
        └── node_modules/
```

Tauri 的 `externalBin` 要求源文件名带 Rust target triple；打包后 sidecar 在最终 bundle 中使用基础名称。citeturn162017search0

## Prepare

```bash
pnpm desktop:sidecar:prepare
```

脚本执行：

1. `pnpm --filter @mcp-gate/core build`
2. `pnpm --filter @mcp-gate/core --prod deploy --legacy .../resources/core-runtime`
3. 读取 `rustc --print host-tuple`
4. 把当前 Node.js runtime 复制为：
   `mcp-gate-node-$TARGET_TRIPLE`

`pnpm deploy` 会创建带独立 production `node_modules` 的可移植目录。citeturn867901search0

## Bundle

```bash
pnpm desktop:bundle
```

该命令使用：

```text
apps/desktop/src-tauri/tauri.production.conf.json
```

把 Node sidecar 和 Core runtime resources 加入 Tauri bundle。Tauri resources 会复制到 App resource directory。citeturn966779search1

## Runtime selection

CoreSupervisor 的优先级：

```text
MCP_GATE_CORE_EXECUTABLE
→ bundled mcp-gate-node + bundled core-runtime
→ development system node + src/main.ts
```

这样开发体验保持简单，正式 App 又不依赖用户安装 Node。

## Remaining release work

当前 staging 还不是最终发布流水线。后续仍需：

- Apple Silicon / Intel 分架构构建
- 正式 App icon
- Developer ID 签名
- sidecar/native addon 签名验证
- notarization
- DMG release workflow
