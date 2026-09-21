# Tool Policy & MCP Editing

## Tool Policy

Tool enable/disable 不再只保存在内存。

默认文件：

```text
~/Library/Application Support/MCP Gate/tool-policy.json
```

策略键使用：

```text
serverId + originalToolName
```

而不是 public tool name。这样 Tool namespace 的显示细节变化不会破坏策略。

## MCP 配置编辑

Management API：

```text
POST /api/server-configs/:id
```

支持更新：

- name
- command
- args
- cwd

编辑前 Core 会 best-effort 断开该 upstream，更新后保留原 alias，避免公开 Tool namespace 发生不必要变化。
