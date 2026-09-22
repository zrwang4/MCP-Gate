# Log Filtering UX

运行日志支持三种组合过滤：

```text
level
source
keyword
```

关键字会匹配 message、source 和 level。

工具栏显示“命中数 / 当前缓存数”。

“一键复制结果”会复制当前全部命中记录：

```text
[ISO timestamp] LEVEL source message
```

桌面端拉取最近 500 条内存日志，面板只渲染最后 120 条命中记录。JSONL 文件格式不变。
