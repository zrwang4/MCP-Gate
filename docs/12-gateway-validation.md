# Gateway Validation

## Unit / protocol tests

```bash
pnpm test
```

Gateway 测试使用 MCP SDK 的 `Client` 与同一份 `InMemoryTransport`
直接连接 low-level Server，验证：

- 聚合 Tool 能从 `tools/list` 返回。
- Public tool name 能进入统一 Gateway。
- `tools/call` 能调用聚合 caller 并返回标准 `CallToolResult`。

## HTTP smoke

Core 启动后：

```bash
pnpm core:dev
```

另一个终端：

```bash
pnpm core:gateway-smoke
```

输出示例：

```json
{
  "ok": true,
  "url": "http://127.0.0.1:24888/mcp",
  "toolCount": 2,
  "tools": [
    "github__create_issue",
    "filesystem__read_file"
  ]
}
```

即使没有连接任何 upstream，smoke 也应该成功，只是 `toolCount` 为 0。
