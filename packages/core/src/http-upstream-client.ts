import { Agent, fetch as undiciFetch } from "undici";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
} from "@modelcontextprotocol/client";
import type { HttpServerConfig } from "./server-registry.ts";
import type { SecretStore } from "./secret-store.ts";
import type { McpToolDefinition } from "./tool-registry.ts";
import type {
  UpstreamClient,
  UpstreamLifecycleHandlers,
} from "./upstream-manager.ts";
import { CORE_VERSION } from "./version.ts";

/** Header names are case-insensitive, so per-key lookups must be too. */
function hasHeaderKey(headers: Record<string, string>, key: string): boolean {
  const needle = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === needle);
}

/**
 * The SDK's `FetchLike` is typed against the DOM `Response` and `RequestInit`,
 * while undici ships its own copies that differ in ways TypeScript can see
 * (`Symbol.dispose` on iterators, `Blob` lineage on `BodyInit`) but that are
 * identical at runtime. undici's Response is used as-is rather than re-wrapped
 * into a standard one because re-wrapping would mean buffering an SSE body the
 * transport expects to stream.
 */
function scopedFetch(agent: Agent): FetchLike {
  const impl = (input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string | URL, {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]);

  return impl as unknown as FetchLike;
}

interface HttpAgentEntry {
  agent: Agent;
  references: number;
}

export interface HttpAgentLease {
  agent: Agent;
  release(): Promise<void>;
}

/**
 * Share Agents by connect timeout while at least one HTTP upstream owns a lease.
 * When the last lease is released, close the Agent and drop it from the pool so
 * changing timeout values over the lifetime of the process cannot grow the pool
 * without bound.
 */
export class HttpAgentPool {
  #entries = new Map<number, HttpAgentEntry>();

  acquire(connectTimeoutMs: number): HttpAgentLease {
    let entry = this.#entries.get(connectTimeoutMs);
    if (!entry) {
      entry = {
        agent: new Agent({ connect: { timeout: connectTimeoutMs } }),
        references: 0,
      };
      this.#entries.set(connectTimeoutMs, entry);
    }

    entry.references += 1;
    let released = false;
    let releasePromise: Promise<void> | null = null;

    return {
      agent: entry.agent,
      release: async () => {
        if (released) return releasePromise ?? Promise.resolve();
        released = true;

        if (entry.references > 0) entry.references -= 1;
        if (entry.references > 0) return;

        this.#entries.delete(connectTimeoutMs);
        releasePromise = entry.agent.close().catch(() => undefined);
        await releasePromise;
      },
    };
  }
}

const httpAgentPool = new HttpAgentPool();

export class HttpUpstreamClient implements UpstreamClient {
  #config: HttpServerConfig;
  #client: Client | null = null;
  #transport: StreamableHTTPClientTransport | null = null;
  #secrets: SecretStore;
  /** Connect timeout, in milliseconds. Node's built-in fetch hard-codes 10s. */
  #connectTimeoutMs: number;
  #agentLease: HttpAgentLease | null = null;
  #lifecycleHandlers: UpstreamLifecycleHandlers = {};

  constructor(
    config: HttpServerConfig,
    secrets: SecretStore,
    connectTimeoutMs = 60_000,
  ) {
    this.#config = config;
    this.#secrets = secrets;
    this.#connectTimeoutMs = connectTimeoutMs;
  }

  setLifecycleHandlers(handlers: UpstreamLifecycleHandlers): void {
    this.#lifecycleHandlers = handlers;
    if (this.#client) this.#bindLifecycle(this.#client);
  }

  async connect(): Promise<void> {
    if (this.#client) return;

    const client = new Client(
      {
        name: "mcp-gate",
        version: CORE_VERSION,
      },
      {
        // 'legacy' is the SDK default and the plain initialize handshake every
        // MCP server supports. The 'auto' mode first probes with
        // `server/discover`, and a server that does not answer that (Apifox,
        // among others) makes the probe hang until the full request timeout,
        // so connecting would take a minute instead of milliseconds.
        versionNegotiation: {
          mode: "legacy",
        },
      },
    );
    this.#bindLifecycle(client);

    const authorization = this.#config.authSecretId
      ? await this.#secrets.get(this.#config.authSecretId)
      : null;

    if (this.#config.authSecretId && !authorization) {
      throw new Error("HTTP authorization secret is missing from Keychain");
    }

    // A configured Authorization header wins over the stored secret, so a caller
    // can override it explicitly rather than having two values fight over one key.
    const headers: Record<string, string> = {
      ...(this.#config.headers ?? {}),
    };
    if (authorization && !hasHeaderKey(headers, "authorization")) {
      headers.Authorization = authorization;
    }

    // Node's built-in fetch hard-codes a 10s connect timeout that cannot be
    // changed per request, and requestInit.dispatcher is silently rejected by
    // it. Routing the transport through undici's own fetch with an explicit
    // dispatcher keeps the timeout scoped to this one upstream, rather than
    // mutating the process-global dispatcher that every other fetch — including
    // the management API and connection tests — would inherit.
    const requestInit: RequestInit = {};
    if (Object.keys(headers).length > 0) {
      requestInit.headers = headers;
    }

    const agentLease = httpAgentPool.acquire(this.#connectTimeoutMs);
    this.#agentLease = agentLease;

    const transport = new StreamableHTTPClientTransport(
      new URL(this.#config.url),
      {
        requestInit,
        fetch: scopedFetch(agentLease.agent),
      },
    );

    this.#client = client;
    this.#transport = transport;

    try {
      await client.connect(transport);
    } catch (error) {
      this.#client = null;
      this.#transport = null;
      this.#agentLease = null;
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => transport.close().catch(() => undefined));
      await agentLease.release();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.#client;
    const transport = this.#transport;
    const agentLease = this.#agentLease;

    if (transport) {
      await transport.terminateSession().catch(() => undefined);
    }
    if (client) {
      await client.close();
    }
    if (agentLease) {
      await agentLease.release();
    }

    // Only clear ownership after the close sequence succeeds. When close
    // fails, keeping these references allows UpstreamManager to retry rather
    // than orphaning the transport and its Agent lease.
    this.#client = null;
    this.#transport = null;
    this.#agentLease = null;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.#requireClient().listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    if (
      args !== undefined &&
      args !== null &&
      (typeof args !== "object" || Array.isArray(args))
    ) {
      throw new Error("tool arguments must be an object");
    }

    return this.#requireClient().callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
  }

  #bindLifecycle(client: Client): void {
    client.onclose = () => {
      this.#client = null;
      this.#transport = null;
      const agentLease = this.#agentLease;
      this.#agentLease = null;
      void agentLease?.release();
      this.#lifecycleHandlers.onClose?.();
    };
    client.onerror = (error) => {
      this.#lifecycleHandlers.onError?.(error);
    };
  }

  #requireClient(): Client {
    if (!this.#client) throw new Error("HTTP upstream is not connected");
    return this.#client;
  }
}
