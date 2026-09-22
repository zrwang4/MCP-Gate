# Test Connection UI

MCP 添加 / 编辑弹窗提供“测试连接”。

测试使用当前表单内容：

```text
stdio:
command + args + cwd + env + secret env

HTTP:
URL + Authorization
```

编辑已有配置时，Secret 输入留空会复用已有 Keychain 值。

成功展示：

- Tool 数量
- 测试耗时
- 最多 12 个 Tool 名称

失败展示连接错误。

测试不会：

- 写入 servers.json
- 修改 Profile
- 修改 Tool policy
- 替换 Keychain Secret

它是保存前的可选检查，不作为保存的强制门槛。
