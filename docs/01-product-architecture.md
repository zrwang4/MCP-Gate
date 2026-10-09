# MCP Gate — Product & Architecture

## Goal

Build a lightweight, Chinese-friendly macOS MCP Gateway desktop app. AI clients connect to one local endpoint:

```text
http://127.0.0.1:24888/mcp
```

The app manages multiple upstream MCP servers behind that endpoint.

## Stack

- Desktop shell: Tauri 2 / Rust
- UI: React + TypeScript + Vite
- Core: Node.js + TypeScript
- Protocol engine: `mcp-proxy`
- MCP upstream clients: MCP TypeScript SDK
- Storage: versioned JSON files with atomic replacement and rotating backups
- Secrets: macOS Keychain

## Layering

```text
React UI
   ├─ Tauri IPC → Rust desktop shell / CoreSupervisor
   └─ authenticated HTTP → Core Management API (:24889)
                              ↓
                    Services / MutationQueue
                              ↓
                  RuntimeReconciler / Stores
                              ↓
                       UpstreamManager
                              ↓
                     STDIO / HTTP clients

AI clients → Gateway (:24888/mcp) → ToolRegistry routes
                                      ↓
                              UpstreamManager.callTool()
                                      ↓
                                 MCP upstreams
```

Rust owns desktop concerns. Core owns MCP concerns. UI must not directly depend on `mcp-proxy`.

The installed app bundles Node and the compiled Core. Rust supervises only the
Core process it starts; an external Core is not taken over or terminated.
The UI obtains the management token through Tauri IPC, then calls the management
HTTP API directly. See [Core supervision](17-tauri-core-supervisor.md) and
[production runtime staging](19-production-core-runtime.md).

`ServerService` and `ProfileService` coordinate persistence, runtime changes and
failure compensation. `RuntimeReconciler` orchestrates batch connection sets;
`UpstreamManager` owns individual connections, generation guards, health checks,
reconnects and circuit recovery. Reads do not perform runtime cleanup.
Cross-service configuration changes and automatic recovery operations share a
serial `MutationQueue`; ordinary gateway tool calls do not enter that queue.
Do not re-enter the queue from an already queued operation.

The Core uses a version-pinned `McpProxyGateway` adapter around
`mcp-proxy`'s programmatic `startHTTPServer()` API. That adapter owns the
public MCP HTTP/protocol session lifecycle. MCP Gate retains product-specific
multi-upstream aggregation, tool naming/policy, Keychain-backed configuration,
and routing. Keep all direct `mcp-proxy` API usage inside the adapter so an
upstream upgrade is isolated and can be gated by compatibility tests.

## Product principles

- localhost-only by default
- one public `/mcp` endpoint
- hide protocol complexity from normal users
- Gateway keys and secret environment values use Keychain; legacy HTTP
  `authSecretId` values also use Keychain. Custom HTTP headers, including
  Authorization configured in the current UI, are plaintext config. Backup
  exports redact Authorization/Cookie-style headers, not arbitrary custom secrets.
- Core is a separate process and runtime directory; automatic independent Core
  upgrades and rollback are a [future design](02-core-update.md), not implemented.
- V1 focuses on Tools before Resources/Prompts/Roots/Sampling/Elicitation

## Current boundaries and recovery rules

Personal use does not currently require SQLite, a concurrent management queue or
an UpstreamRuntime FSM rewrite. Single-file writes are atomic; cross-file and
Keychain operations use compensation rather than a shared database transaction.
Backup restore reloads in-memory stores, but a Core restart is still required for
existing connections and gateway sessions to fully adopt restored settings.

Queued reconnect and circuit recovery tasks revalidate their runtime/generation
at execution time; circuit recovery also verifies client identity and circuit state.
Tasks superseded by manual operations are skipped rather than acting on a new client.
Profile activation and active Profile editing snapshot the previous connection
targets, including upstreams awaiting recovery, and use that set for failure compensation.
Compensation can itself fail; it does not promise to restore identical transports
or the exact retry/circuit timing of the previous state.

The desktop submits server configuration and environment edits in one request.
Core writes both into the same registry update and reconnects at most once.
The legacy environment-only endpoint remains available. Keychain entries are
staged before persistence; newly created entries are cleaned up on failure and
obsolete entries are removed after a successful save.

Management mutations default to a three-minute desktop wait budget, while reads
default to four seconds. A UI timeout means the result is uncertain, not that
the backend mutation was cancelled; refresh actual state before retrying.
