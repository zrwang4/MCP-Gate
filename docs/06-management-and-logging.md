# Management API 与日志设计

## 当前实现

Core 在 MCP Gateway 端口之外增加一个仅绑定 loopback 的管理端口：

- MCP: `http://127.0.0.1:24888/mcp`
- Management API: `http://127.0.0.1:24889`

管理 API 不暴露到 LAN。桌面 UI 使用它读取状态、日志以及控制当前 Filesystem PoC 的生命周期。

### API

- `GET /api/health`
- `GET /api/status`
- `GET /api/servers`
- `GET /api/logs?limit=200`
- `POST /api/servers/filesystem-poc/start`
- `POST /api/servers/filesystem-poc/stop`
- `POST /api/servers/filesystem-poc/restart`

控制接口要求 `X-MCP-Gate-Client: desktop`，并且浏览器 Origin 只允许本地 Tauri/Vite 开发来源。

## 日志

Core 使用结构化 JSONL：

```text
~/Library/Logs/MCP Gate/core.jsonl
```

当前策略：

- 内存保留最近 1000 条，用于 UI 快速查看。
- 单文件达到约 5 MB 时启动时滚动为 `core.jsonl.1`。
- 对常见 `authorization`、`token`、`apiKey`、`password`、`secret`、`cookie` 做基础脱敏。
- UI 支持 Info / Warn / Error / Debug 过滤。

后续建议增加：

- 按天或按大小更完整的日志轮转。
- Tool 调用审计日志与 Core 运行日志分离。
- 导出诊断包时再次做字段级脱敏。

## MCP 管理边界

当前版本只管理 PoC 的 Filesystem MCP，支持：

- 状态
- PID
- 启动时间
- 最近错误
- 启动
- 停止
- 重启

“添加 MCP”暂时禁用。原因是下一阶段会改为真正的 `UpstreamManager + ToolRegistry + ToolRouter` 多 MCP 聚合模型；现在如果简单起多个 mcp-proxy/端口，会形成错误的长期架构。
