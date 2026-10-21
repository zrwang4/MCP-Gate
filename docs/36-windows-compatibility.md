# Windows 构建与运行兼容

## 当前范围

Windows 差异包基于 `87cad81`，主要修复安装器构建和捆绑 Core 启动。
仓库吸收其 `.exe` 命名、JS 包管理器入口、Windows 路径处理及平台条件思路，
但不直接采用会静默漏文件的递归复制实现。

这不是“Windows 全功能支持”的声明。Windows 原生打包、安装、启动和真实 MCP
调用需要在 Windows 环境验证；macOS 上的分支测试不能替代该验证。

## 实现边界

- `scripts/runtime-staging.mjs` 供两个 staging 脚本共用。
- Windows 直接用当前 Node 执行 `corepack.js` / `npm-cli.js`，避免 `.cmd` 启动问题，
  不启用 `shell: true`。找不到 npm JS 入口时明确失败；请安装 Node 22、npm 和
  项目固定的 pnpm 10.17.1/corepack。
- Windows 逐条复制，按当前递归祖先链检测目录循环；重复文件/目录别名都应完整物化。
  断链、循环、不可读文件会使 staging 失败，不能只输出警告后打包。
- macOS/Linux 保留原生 `cpSync` 解引用路径。外部 store 链接需要复制到包内，
  已知 workspace 自引用可去除。生产依赖在两个 staging 流程完成时都检查可导入性，
  尤其是 Tauri `beforeBuildCommand` 重建后的最终 runtime。
- Windows 资源名为 `core-runtime/node.exe`，Unix 为 `core-runtime/node`。
  Rust 只查找普通 sidecar 文件、与 Cargo TARGET 精确匹配的带后缀文件、或平台对应资源副本，
  不按 glob 排序选任意架构。
- Windows Node/Core 路径去掉驱动器/UNC verbatim 前缀，保留 UTF-16，不做有损字符转换。
  macOS 路径保持原样；ActivationPolicy API 仅在 macOS 编译。

## 本地验证

使用 Node 22：

```sh
npm run typecheck
npm test
npm run build
npm run desktop:sidecar:prepare
node scripts/prepare-desktop-runtime.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

`npm test` 包含 Core 测试和 staging 脚本测试。脚本测试覆盖重复链接、目录循环、
断链、外部依赖物化、包管理器入口和最终依赖导入；Windows 文件 symlink 测试在缺少权限时
会明确 skip，建议开启 Developer Mode 后复测，不能把 skip 当成已验证。

打包安装前必须通过相应平台检查：

```sh
npm run desktop:bundle:local
```

在 Windows 验证 NSIS/MSI 安装版：

1. 未依赖开发目录、系统 Node 或 pnpm store，即可使用 `managed-bundled-node` 启动。
2. 管理端点为 `/api/health`；携带桌面 token 后可读取 `/api/status`。
3. 实际连接无 Secret 的 stdio/HTTP MCP，执行一次工具调用，并验证重启/退出。
4. 复测含空格、中文和 OneDrive 的路径。长路径/网络共享路径仍需实机检查。

## 尚未覆盖的产品能力

- `createPlatformSecretStore()` 在 Windows 返回 `UnsupportedSecretStore`：
  Gateway API Key、STDIO Secret 环境变量、旧 HTTP `authSecretId` 不可用。
  因而需要可用 API Key 的 LAN 模式也不可用；不要用明文文件静默替代安全存储。
- 数据与日志默认仍沿用 `%USERPROFILE%/Library/...`，未迁移到 AppData；
  后续改目录必须设计旧数据迁移，不能直接让已有配置消失。
- Core 测试仍有历史平台假设，Windows 必须记录具体失败，而不是笼统视为兼容通过。
- 签名 Windows 安装器、自动更新、Windows 原生凭据存储不在本轮范围内。
