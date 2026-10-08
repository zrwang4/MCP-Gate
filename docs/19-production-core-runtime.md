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

Tauri 的 `externalBin` 要求源文件名带 Rust target triple；打包后 sidecar 在最终 bundle 中使用基础名称。

## Prepare

```bash
npm run desktop:sidecar:prepare
```

脚本执行：

1. `pnpm --filter @mcp-gate/core build`
2. `pnpm --filter @mcp-gate/core --prod deploy --legacy .../resources/core-runtime`
3. 使用 `MCP_GATE_TARGET_TRIPLE` 或读取 `rustc --print host-tuple`
4. 把当前 Node.js runtime 复制为：
   `mcp-gate-node-$TARGET_TRIPLE`

脚本优先通过 corepack 使用项目固定的 pnpm 10.17.1；也会检查 PATH 上的
pnpm 是否支持 `deploy --legacy`。部署使用 hoisted 布局，将依赖符号链接实体化，
最后验证生产依赖可解析，避免 App 复制资源后出现依赖缺失。

`npm run` 只是入口，staging 仍需要可用的 pnpm。Node sidecar 是当前
`process.execPath` 的副本；本项目构建、测试和本地打包使用 Node 22。

## Bundle

```bash
npm run typecheck
npm test
npm run desktop:bundle
```

该命令使用：

```text
apps/desktop/src-tauri/tauri.production.conf.json
```

把 Node sidecar 和 Core runtime resources 加入 Tauri bundle。Tauri resources 会复制到 App resource directory。

## Runtime selection

CoreSupervisor 的优先级：

```text
MCP_GATE_CORE_EXECUTABLE
→ bundled mcp-gate-node + bundled core-runtime
→ development system node + src/main.ts
```

这样开发体验保持简单，正式 App 又不依赖用户安装 Node。

## Release status

仓库已配置 App 图标、无签名 preview 流水线，以及 Apple Silicon / Intel
双架构正式发布流水线。正式流程包含 Developer ID 签名、公证、App/Node sidecar
签名验证、DMG/App ZIP 和校验和；需要配置 Apple 凭据并实际运行验证，
不能仅凭存在 workflow 就认定产物已经签名发布。
详见 [macOS Signed Release](33-macos-signed-release.md)。

本机无签名验证使用 `npm run desktop:bundle:local`，同样应先通过类型检查与测试。
当前禁用 Tauri Updater；独立 Core 下载、版本切换和自动回滚仍是规划。
UI 变更需完整重建 App，只有 Core 变更时本机可在退出 App 后替换 runtime 资源；
这种手动替换不是自动更新机制，修改正式签名 App 的资源也会影响签名有效性。
