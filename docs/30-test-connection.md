# Test MCP Connection Before Save

Management API:

```text
POST /api/server-configs/test-connection
```

测试过程不会写入 `servers.json`。

```text
form values
   ↓
temporary in-memory config
   ↓
connect upstream
   ↓
tools/list
   ↓
disconnect
```

## Secret behavior

编辑已有 stdio Server：

```text
API_TOKEN=
```

会从现有 Keychain 引用读取值用于测试。

HTTP Authorization 留空同样复用已有 Keychain 值。

新增 Secret 没有旧值时必须提供实际值。

## Response

```json
{
  "result": {
    "transport": "stdio",
    "toolCount": 3,
    "toolNames": ["read", "write", "search"],
    "durationMs": 420
  }
}
```

不会返回 Secret。
