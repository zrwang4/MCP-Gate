# Profile Quick Switch

Gateway 概览现在直接显示当前 Profile，并提供下拉快捷切换。

```text
当前场景  Coding        [ Coding ▾ ]
```

选择另一个 Profile 会调用其 activate API，执行 exact-set reconcile。

选择：

```text
手动模式（无 Profile）
```

会停用当前 active Profile，并把 `activeProfileId` 清空。

这不会修改每个 MCP Server 自身的 `autoStart` 配置；autoStart 仍只用于 Core 下次启动时没有 active Profile 的情况。
