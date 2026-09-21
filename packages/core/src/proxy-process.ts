import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolvePackageBin } from "./package-bin.ts";
import type { CoreConfig } from "./config.ts";

export class McpProxyProcess {
  #child: ChildProcess | null = null;

  async start(config: CoreConfig): Promise<void> {
    if (this.#child) {
      throw new Error("mcp-proxy process is already running");
    }

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

    child.stdout?.on("data", (chunk) => {
      process.stdout.write(`[mcp-proxy] ${String(chunk)}`);
    });

    child.stderr?.on("data", (chunk) => {
      process.stderr.write(`[mcp-proxy] ${String(chunk)}`);
    });

    child.once("exit", (code, signal) => {
      this.#child = null;
      if (code !== 0 && signal == null) {
        console.error(`[core] mcp-proxy exited with code ${code}`);
      } else {
        console.info(`[core] mcp-proxy stopped (${signal ?? code ?? "unknown"})`);
      }
    });

    child.once("error", (error) => {
      this.#child = null;
      console.error("[core] failed to start mcp-proxy", error);
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });

      child.kill("SIGTERM");
    });

    this.#child = null;
  }
}
