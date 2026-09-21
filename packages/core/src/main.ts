import { loadConfig } from "./config.ts";
import { waitForGateway } from "./health.ts";
import { McpProxyProcess } from "./proxy-process.ts";

const proxy = new McpProxyProcess();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.info(`[core] received ${signal}, shutting down`);
  await proxy.stop();
  process.exit(0);
}

async function main(): Promise<void> {
  const config = loadConfig();

  console.info("[core] MCP Gate Core PoC starting");
  console.info(`[core] filesystem root: ${config.filesystemRoot}`);
  console.info(`[core] gateway: http://${config.host}:${config.port}/mcp`);

  await proxy.start(config);
  await waitForGateway(config);

  console.info(
    JSON.stringify({
      event: "core.ready",
      gatewayUrl: `http://${config.host}:${config.port}/mcp`,
      healthUrl: `http://${config.host}:${config.port}/ping`,
      upstream: {
        id: "filesystem-poc",
        root: config.filesystemRoot,
      },
    }),
  );
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error("[core] startup failed", error);
  await proxy.stop();
  process.exit(1);
});
