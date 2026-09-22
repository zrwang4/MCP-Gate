# Profiles

Profiles 用来保存一组 MCP Server，并在不同工作场景之间快速切换。

默认文件：

```text
~/Library/Application Support/MCP Gate/profiles.json
```

## Semantics

激活 Profile：

```text
current running set
        ↓
disconnect servers not in profile
        ↓
connect enabled servers in profile
        ↓
activeProfileId persisted
```

因此 Profile 表示“期望运行集合”，而不是简单批量 start。

停用 Profile 只断开该 Profile 的成员，并在它是当前 active Profile 时清空 `activeProfileId`。

## Startup restore

Core 启动后：

```text
active Profile exists
  → restore exact profile set
otherwise
  → connect enabled + autoStart servers
```

## Management API

```text
GET    /api/profiles
POST   /api/profiles
POST   /api/profiles/:id
POST   /api/profiles/:id/activate
POST   /api/profiles/:id/deactivate
DELETE /api/profiles/:id
```
