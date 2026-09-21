import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.ts";
import { CoreLogger } from "./logger.ts";
import { ManagementServer } from "./management-server.ts";
import { ServerRegistry } from "./server-registry.ts";
import { McpProxyProcess } from "./proxy-process.ts";

let shuttingDown = false;

async function main(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.filesystemRoot, { recursive: true });
  const logger = new CoreLogger(config.logFile);
  await logger.init();

  const proxy = new McpProxyProcess(logger);
  const registry = new ServerRegistry(config.serverConfigFile, logger);
  await registry.init();
  const management = new ManagementServer(config, proxy, registry, logger);

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("core", `received ${signal}, shutting down`);
    await management.stop().catch((error) => {
      logger.warn("management", `shutdown failed: ${String(error)}`);
    });
    await proxy.stop().catch((error) => {
      logger.warn("filesystem", `shutdown failed: ${String(error)}`);
    });
    await logger.flush();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("core", "MCP Gate Core starting");
  logger.info("core", `filesystem root: ${config.filesystemRoot}`);
  logger.info("core", `gateway: http://${config.host}:${config.port}/mcp`);
  logger.info(
    "core",
    `management: http://${config.managementHost}:${config.managementPort}`,
  );

  await management.start();

  try {
    await proxy.start(config);
    logger.info("core", "Core is ready");
  } catch (error) {
    logger.error("core", `initial MCP start failed: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn("core", "Management API remains available so the service can be retried from the UI");
  }
}

main().catch((error) => {
  console.error("[core] fatal startup failure", error);
  process.exitCode = 1;
});
