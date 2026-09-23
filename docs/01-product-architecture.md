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
- Storage: SQLite
- Secrets: macOS Keychain

## Layering

```text
React UI
   ↓ Tauri IPC
Tauri / Rust
   ↓ local IPC
MCP Gate Core
   ↓
Gateway / Tool Registry / Router
   ↓
MCP upstream servers
```

Rust owns desktop concerns. Core owns MCP concerns. UI must not directly depend on `mcp-proxy`.

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
- secrets never stored in plaintext config
- Core can upgrade independently from the App
- V1 focuses on Tools before Resources/Prompts/Roots/Sampling/Elicitation
