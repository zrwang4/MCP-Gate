# Safe LAN Mode

MCP Gate is localhost-only by default.

LAN access can only be enabled when the Gateway API Key is enabled and available from secure storage.

## Binding

Default:

```text
127.0.0.1:24888
```

LAN mode:

```text
0.0.0.0:24888
```

The Management API stays on:

```text
127.0.0.1:24889
```

and is never exposed through LAN mode.

## Request validation

MCP Gate keeps the SDK's DNS-rebinding protections enabled.

For localhost it uses:

```ts
localhostHostValidation()
localhostOriginValidation()
```

For LAN it uses explicit hostname allowlists:

```ts
hostHeaderValidation(allowedHostnames)
originValidation(allowedHostnames)
```

The allowlist contains localhost, the machine hostname, and active non-internal IPv4 addresses.

## Authentication invariant

LAN mode requires a usable Gateway API Key.

If the Keychain item disappears, LAN mode is automatically disabled on the next Core startup. Disabling the API Key while LAN is active immediately rebinds the Gateway to localhost.

The public `/mcp` endpoint still requires:

```http
Authorization: Bearer <gateway-api-key>
```

## Hot rebind

Changing LAN mode stops and restarts only the public Gateway listener. The Core process, upstream MCP connections, Registry, Profiles, logs, audit log, and Management API remain running.
