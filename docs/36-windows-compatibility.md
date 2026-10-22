# Windows 构建与运行兼容

## 当前范围

Windows 差异包基于 `87cad81`，主要修复安装器构建和捆绑 Core 启动。
仓库吸收其 `.exe` 命名、JS 包管理器入口、Windows 路径处理及平台条件思路，
但不直接采用会静默漏文件的递归复制实现。

这不是“Windows 全功能支持”的声明。Windows 原生打包、安装、启动和真实 MCP
调用需要在 Windows 环境验证；macOS 上的分支测试不能替代该验证。

当前 `.github/workflows/ci.yml` 仅保留 Ubuntu 测试和 macOS Rust 检查。
之前新增的 `windows-runtime` job 已还原，未提供 Windows CI 验证结果，
也未完成 Windows 原生安装验证。详见 [CI 现状](13-ci.md)。

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

## Windows release 控制台

基于 `f5bf9cc` 的第二份差异包（`windows-no-console-f5dea0d.patch`）整合为：

- Windows release 主程序声明 GUI 子系统，debug 及非 Windows 目标不变。
- 桌面 supervisor 启动 Core 时，仅在 Windows release 添加 `CREATE_NO_WINDOW`。
  stdin 仍为 null；stdout/stderr 改为 null，避免依赖 GUI 父进程的控制台句柄。
- 不引入补丁中的 `core-stdout.log`。CoreLogger 仍使用现有脱敏、轮转的 `core.jsonl`；
  未经 CoreLogger 的原始输出（包括早期启动异常及 upstream 直接继承的 stderr）
  不会额外保存。需要原始控制台诊断时使用 Windows debug 构建。
- 此改动不调整 Core 终止策略、连接逻辑、凭据存储或 macOS 日志路径。

包内 Windows 测试记录属于补丁作者提供的结果，不等同于整合后版本的实机验证。
当前无 Windows CI；macOS Rust 检查不会编译 `CREATE_NO_WINDOW` 条件分支。

## Windows 托盘图标

基于 `c7892e5` 的托盘图标差异包整合后，仅在 Windows 为手动创建的
`TrayIconBuilder` 显式设置 `app.default_window_icon()`。
Builder 不会自动回退到应用图标，而 Windows 不支持 `.title("MCP")`；
缺少图片时底层不设置 `NIF_ICON`，可能出现空白或不可见托盘项。
当前 Windows 图标来自 `icons/icon.ico`，不新增图标资源或依赖。

macOS 保持原来的纯文字 `MCP` 菜单栏项；菜单中的打开、重启 Core、退出行为不变。
关闭主窗口会隐藏到托盘，最小化仍走系统默认行为，不会自动隐藏到托盘。

Windows 11 可能将图标放入“隐藏的图标”溢出区，这与图标未正确设置不同。
需要常驻任务栏时，可在系统任务栏设置中开启或手动拖到通知区，不由应用修改注册表。

补丁作者提供了 Windows 实测记录；当前整合版仍需按下方清单进行 Windows 原生验证。
macOS Rust 检查不覆盖这段 Windows 专用设置。

## 本地验证

使用 Node 22：

```sh
npm run typecheck
npm test
npm run build
npm run desktop:sidecar:prepare
node scripts/prepare-desktop-runtime.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo check --release --manifest-path apps/desktop/src-tauri/Cargo.toml --bins
```

`npm test` 包含 Core 测试、staging 脚本测试和桌面列表排序逻辑测试。staging 测试覆盖重复链接、目录循环、
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
5. 从开始菜单启动 release 安装版，确认主程序及 Core 没有弹出控制台；连接 stdio MCP、
   重启 Core 和退出 App 时再次检查。debug 保留控制台属于预期行为。
6. `/api/health` 应返回 200；`/health` 不是健康端点，返回 403 不能证明 Core 健康。
   携带管理 token 和 `x-mcp-gate-client: desktop` 请求 `/api/status`，并检查
   `core.jsonl` 写入正常；不应生成新的 `core-stdout.log`。
7. 检查通知区及隐藏图标溢出区中的 MCP Gate 图标不是空白；关闭窗口后，
   通过托盘菜单重新打开窗口、重启 Core 和退出，确认对应行为正常。

## 尚未覆盖的产品能力

- `createPlatformSecretStore()` 在 Windows 返回 `UnsupportedSecretStore`：
  Gateway API Key、STDIO Secret 环境变量、旧 HTTP `authSecretId` 不可用。
  因而需要可用 API Key 的 LAN 模式也不可用；不要用明文文件静默替代安全存储。
- 数据与日志默认仍沿用 `%USERPROFILE%/Library/...`，未迁移到 AppData；
  后续改目录必须设计旧数据迁移，不能直接让已有配置消失。
- Core 测试仍有历史平台假设，Windows 必须记录具体失败，而不是笼统视为兼容通过。
- 签名 Windows 安装器、自动更新、Windows 原生凭据存储不在本轮范围内。
