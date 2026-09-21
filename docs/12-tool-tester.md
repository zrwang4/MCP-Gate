# Tool Tester & Gateway Call Smoke

## Desktop Tool Tester

Tools 页面提供“测试”按钮。

用户必须显式打开测试器并点击“运行 Tool”。MCP Gate 不会自动调用任何 upstream Tool，因为 Tool 可能具有文件修改、网络请求或其他真实副作用。

本地 Management API：

```text
POST /api/tools/:publicName/call
```

Body:

```json
{
  "arguments": {}
}
```

## End-to-end Gateway Smoke

只测试 tools/list：

```bash
pnpm core:gateway-smoke
```

显式测试 tools/call：

```bash
MCP_GATE_SMOKE_TOOL="filesystem__read_file" \
MCP_GATE_SMOKE_ARGS='{"path":"/tmp/example.txt"}' \
pnpm core:gateway-smoke
```

该命令通过真正的 Streamable HTTP `/mcp` 连接执行，因此能验证公开 Gateway 的完整调用路径。
