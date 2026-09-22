# Tool Call Audit

MCP Gate keeps Tool-call audit events separate from operational Core logs.

Default file:

```text
~/Library/Logs/MCP Gate/audit.jsonl
```

## Recorded

Each event contains:

- timestamp
- source: `gateway` or `tester`
- public Tool name
- upstream server id / alias
- original upstream Tool name
- duration
- success/failure
- redacted error message on failure

## Never recorded

The audit path intentionally has no fields for:

- Tool arguments
- Tool result/content
- HTTP Authorization
- environment values
- Keychain Secret values

## Management API

```text
GET /api/audit?after=0&limit=100&success=true&source=gateway
```

The route is protected by the Management session token.

The desktop UI shows recent audit events in a separate panel.
