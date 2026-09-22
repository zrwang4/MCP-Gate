# Profiles UI

桌面端新增 Profiles 管理区。

每个 Profile 卡片显示：

- Profile 名称
- 是否为当前 active Profile
- 成员数量 / 运行中数量
- 成员 MCP 名称和状态

操作：

```text
激活
停用
编辑
删除
```

激活 Profile 会调用 Core 的 exact-set reconcile：未选中的 MCP 会断开，选中的 enabled MCP 会连接。

空 Profile 是合法的，激活后等价于断开所有 MCP。

Profile 编辑器使用 MCP 复选框，不暴露 Server ID。
