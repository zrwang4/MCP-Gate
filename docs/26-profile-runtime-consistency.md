# Profile Runtime Consistency

Profile 的持久化配置与当前运行集合保持一致。

## Edit active profile

如果正在编辑的 Profile 就是当前 active Profile：

```text
save new members
   ↓
persist profile
   ↓
applyExactSet(new members)
   ↓
runtime immediately matches saved profile
```

普通未激活 Profile 的编辑不会改变运行状态。

## Delete active profile

删除当前 Profile 时：

```text
disconnectSet(profile members)
   ↓
remove profile
   ↓
activeProfileId = null
```

若部分断开失败，删除仍会完成，并把失败信息返回给桌面端。

## Quick selection

Profile 编辑器提供：

- 使用当前运行集合
- 全选已启用
- 清空

便于快速从当前工作状态生成 Profile。
