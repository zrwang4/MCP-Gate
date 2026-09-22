# stdio Environment & Secrets

很多本地 MCP Server 通过环境变量读取配置和 Token。MCP Gate 现在支持两类 stdio env。

## Plain environment

普通变量：

```text
MODE=production
API_URL=https://example.com
```

会保存在 `servers.json`。

## Secret environment

例如：

```text
GITHUB_TOKEN=...
API_KEY=...
```

真实值写入 macOS Keychain，`servers.json` 只保存 opaque Secret ID。

Management API 不返回这些 Secret ID，只返回 `secretEnvKeys`。

## Editing semantics

在桌面端编辑已有 Secret：

```text
GITHUB_TOKEN=
```

表示保留现有 Keychain 值。

删除整行表示删除该 Secret。新增 Secret 时必须提供非空值。

## Runtime

连接 stdio upstream 前：

```text
plain env
   +
Keychain secret env
   ↓
StdioClientTransport({ env })
```

MCP SDK 会继续合并 HOME、LOGNAME、PATH、SHELL、TERM、USER 等安全默认变量。
