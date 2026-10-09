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

运行集合应用失败时，不保存新成员，并尝试恢复操作前的期望连接集合；持久化失败时，
Store 恢复内存状态，Service 尝试恢复同一目标快照。回滚本身也可能失败。

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
失败补偿目标是在 mutation slot 内、执行前保存的期望连接快照，而不是旧 Profile
的静态成员列表。快照包括手动连接，以及正在重连或熔断等待中的上游。
没有旧 active Profile 或重复激活当前 Profile，也使用同一快照进行回滚。
active Profile ID 只有应用和持久化成功后才改变。

快照恢复的是目标集合，不是旧客户端实例、熔断计数或重试时间；恢复连接可能失败，
失败明细通过 rollback 结果或错误消息报告。

## Quick selection

Profile 编辑器提供：

- 使用当前运行集合
- 全选已启用
- 清空

便于快速从当前工作状态生成 Profile。
