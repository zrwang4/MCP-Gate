# Diagnostics Snapshot

MCP Gate can generate a support-safe diagnostics snapshot:

```text
GET /api/diagnostics
```

The endpoint is protected by the Management API session token.

Included:

- Core/runtime version and OS architecture
- Gateway status
- Profiles and active Profile
- Server metadata
- Upstream status / reconnect state
- Tool names and enable state
- latest warning/error logs

Excluded or transformed by default:

- Keychain values
- opaque Secret IDs
- plain environment variable values
- stdio argument values
- HTTP username/password/query/hash
- full Home prefix (replaced with `~`)

The desktop Settings section provides “复制诊断信息”, copying the snapshot as formatted JSON to the clipboard.
