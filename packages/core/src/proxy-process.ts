import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolvePackageBin } from "./package-bin.ts";
import type { CoreConfig } from "./config.ts";
import type { CoreLogger } from "./logger.ts";

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

      child.once("exit", (code, signal) => {
        this.#child = null;
        this.#startedAt = null;
        if (this.#status === "stopping") {
          this.#status = "stopped";
          this.#logger.info("filesystem", `stopped (${signal ?? code ?? "unknown"})`);
          return;
        }

        if (code !== 0 && signal == null) {
          this.#status = "error";
          this.#lastError = `mcp-proxy exited with code ${code}`;
          this.#logger.error("filesystem", this.#lastError);
        } else {
          this.#status = "stopped";
          this.#logger.info("filesystem", `stopped (${signal ?? code ?? "unknown"})`);
        }
      });

      child.once("error", (error) => {
        this.#child = null;
        this.#startedAt = null;
        this.#status = "error";
        this.#lastError = error.message;
        this.#logger.error("filesystem", `failed to start: ${error.message}`);
      });
    } catch (error) {
      this.#status = "error";
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#logger.error("filesystem", this.#lastError);
      throw error;
    }
  }

  markReady(): void {
    if (this.#child) {
      this.#status = "running";
      this.#logger.info("filesystem", "MCP endpoint is ready");
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) {
      this.#status = "stopped";
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
