# Profile Runtime Consistency

Profile 通过 `ProfileService`、共享 `MutationQueue` 和 `RuntimeReconciler`
协调持久化配置与运行集合。失败补偿尽力恢复状态，不保证所有上游都能恢复连接。

## Edit active profile

如果正在编辑的 Profile 就是当前 active Profile：

```text
validate new members inside mutation queue
    ↓
applyExactSet(new members)
    ↓
persist profile
    ↓
return updated profile and runtime result
```

普通未激活 Profile 的编辑不会改变运行状态。

运行集合应用失败时，不保存新成员，并尝试恢复旧成员集合；持久化失败时，
Store 恢复内存状态，Service 尝试恢复旧成员集合。回滚本身也可能失败。

## Delete active profile

删除当前 Profile 时：

```text
disconnectSet(profile members)
   ↓
remove profile
   ↓
activeProfileId = null
```

若部分断开失败，不删除 Profile，返回 `ok: false` 和失败明细。
若断开成功但删除持久化失败，保留原 Profile，并尝试恢复其连接集合。
删除或停用非 active Profile 不会断开它与 active Profile 共享的服务器。

## Activation and rollback boundary

激活时先 `applyExactSet()`，全部成功后才保存 active Profile ID。
当前失败补偿目标是此前 active Profile 的成员；没有旧 active Profile 时使用空集合。
重复激活同一 active Profile 时，当前实现也会选用空集合回滚。

因此失败补偿尚不能保证恢复操作前的实际连接目标：手动连接、或与 active Profile
成员不一致的运行状态可能丢失。后续应在操作前保存连接目标快照，再用于失败恢复。

## Quick selection

Profile 编辑器提供：

- 使用当前运行集合
- 全选已启用
- 清空

便于快速从当前工作状态生成 Profile。
