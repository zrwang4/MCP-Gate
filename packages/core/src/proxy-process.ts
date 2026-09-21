import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { CoreConfig } from "./config.ts";
import { waitForGateway } from "./health.ts";
import type { CoreLogger } from "./logger.ts";
import { resolvePackageBin } from "./package-bin.ts";

export type ManagedServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ManagedServerSnapshot {
  id: string;
  name: string;
  transport: "stdio";
  status: ManagedServerStatus;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
  root: string;
}

export class McpProxyProcess {
  #child: ChildProcess | null = null;
  #status: ManagedServerStatus = "stopped";
  #startedAt: string | null = null;
  #lastError: string | null = null;
  #logger: CoreLogger;

  constructor(logger: CoreLogger) {
    this.#logger = logger;
  }

  snapshot(config: CoreConfig): ManagedServerSnapshot {
    return {
      id: "filesystem-poc",
      name: "Filesystem",
      transport: "stdio",
      status: this.#status,
      pid: this.#child?.pid ?? null,
      startedAt: this.#startedAt,
      lastError: this.#lastError,
      root: config.filesystemRoot,
    };
  }

  async start(config: CoreConfig): Promise<void> {
    if (this.#child || this.#status === "starting" || this.#status === "running") {
      throw new Error("Filesystem MCP is already running");
    }

    this.#status = "starting";
    this.#lastError = null;

    try {
      await access(config.filesystemRoot, constants.R_OK | constants.W_OK);

      const proxyBin = await resolvePackageBin("mcp-proxy", "mcp-proxy");
      const filesystemBin = await resolvePackageBin(
        "@modelcontextprotocol/server-filesystem",
        "mcp-server-filesystem",
      );

      const args = [
        proxyBin,
        "--host",
        config.host,
        "--port",
        String(config.port),
        "--server",
        "stream",
        "--upstreamProtocol",
        "auto",
        "--connectionTimeout",
        String(config.connectionTimeoutMs),
        "--requestTimeout",
        String(config.requestTimeoutMs),
        "--sessionIdleTimeout",
        String(config.sessionIdleTimeoutMs),
        "--",
        process.execPath,
        filesystemBin,
        config.filesystemRoot,
      ];

      const child = spawn(process.execPath, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.#child = child;
      this.#startedAt = new Date().toISOString();
      this.#logger.info("filesystem", `starting process${child.pid ? ` pid=${child.pid}` : ""}`);

      child.stdout?.on("data", (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) this.#logger.info("mcp-proxy", line);
        }
      });

      child.stderr?.on("data", (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) this.#logger.warn("mcp-proxy", line);
        }
      });

      const terminated = new Promise<
        | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
        | { type: "error"; error: Error }
      >((resolve) => {
        child.once("exit", (code, signal) => {
          const wasStopping = this.#status === "stopping";
          this.#child = null;
          this.#startedAt = null;

          if (wasStopping) {
            this.#status = "stopped";
            this.#logger.info("filesystem", `stopped (${signal ?? code ?? "unknown"})`);
          } else {
            this.#status = "error";
            this.#lastError = `mcp-proxy exited unexpectedly (${signal ?? code ?? "unknown"})`;
            this.#logger.error("filesystem", this.#lastError);
          }

          resolve({ type: "exit", code, signal });
        });

        child.once("error", (error) => {
          if (this.#child === child) {
            this.#child = null;
            this.#startedAt = null;
          }
          this.#status = "error";
          this.#lastError = error.message;
          this.#logger.error("filesystem", `failed to start: ${error.message}`);
          resolve({ type: "error", error });
        });
      });

      const outcome = await Promise.race([
        waitForGateway(config).then(() => ({ type: "ready" as const })),
        terminated,
      ]);

      if (outcome.type === "exit") {
        throw new Error(`mcp-proxy exited before readiness (${outcome.signal ?? outcome.code ?? "unknown"})`);
      }
      if (outcome.type === "error") {
        throw outcome.error;
      }

      if (this.#child !== child) {
        throw new Error("mcp-proxy exited before readiness");
      }

      this.#status = "running";
      this.#logger.info("filesystem", "MCP endpoint is ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (this.#child) {
        await this.stop().catch((stopError) => {
          this.#logger.warn("filesystem", `cleanup after failed start failed: ${String(stopError)}`);
        });
      }

      this.#status = "error";
      this.#lastError = message;
      this.#logger.error("filesystem", message);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) {
      if (this.#status !== "error") this.#status = "stopped";
      this.#startedAt = null;
      return;
    }

    this.#status = "stopping";
    this.#logger.info("filesystem", "stopping process");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#logger.warn("filesystem", "graceful shutdown timed out; sending SIGKILL");
        child.kill("SIGKILL");
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      child.kill("SIGTERM");
    });

    this.#child = null;
    this.#status = "stopped";
    this.#startedAt = null;
  }
}
