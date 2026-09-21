import { mkdir } from "node:fs/promises";
import { AuditLogger } from "./audit-logger.ts";
import { loadConfig } from "./config.ts";
import { CoreLogger } from "./logger.ts";
import { GatewayAccessController } from "./gateway-access.ts";
import { GatewayServer } from "./gateway-server.ts";
import { HttpUpstreamClient } from "./http-upstream-client.ts";
import { ManagementServer } from "./management-server.ts";
import { ProfileStore } from "./profile-store.ts";
import { ServerRegistry } from "./server-registry.ts";
import { createPlatformSecretStore } from "./secret-store.ts";
import { ToolPolicyStore } from "./tool-policy-store.ts";
import { ToolRegistry } from "./tool-registry.ts";
import { StdioUpstreamClient } from "./stdio-upstream-client.ts";
import { UpstreamManager } from "./upstream-manager.ts";

let shuttingDown = false;

async function main(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.filesystemRoot, { recursive: true });
  const logger = new CoreLogger(config.logFile);
  await logger.init();
  const audit = new AuditLogger(config.auditFile);
  await audit.init();

  const registry = new ServerRegistry(config.serverConfigFile, logger);
  await registry.init();
  const profiles = new ProfileStore(config.profileFile, logger);
  await profiles.init();
  const toolPolicy = new ToolPolicyStore(config.toolPolicyFile, logger);
  await toolPolicy.init();
  const toolRegistry = new ToolRegistry(toolPolicy);
  const secrets = createPlatformSecretStore();
  const gatewayAccess = new GatewayAccessController(
    config.gatewayAccessFile,
    secrets,
    logger,
  );
  await gatewayAccess.init();
  const upstreams = new UpstreamManager(
    registry,
    toolRegistry,
    (serverConfig) =>
      serverConfig.transport === "http"
        ? new HttpUpstreamClient(serverConfig, secrets)
        : new StdioUpstreamClient(serverConfig, secrets),
    logger,
    { audit },
  );
  upstreams.syncConfigs();
  const gateway = new GatewayServer(
    config,
    toolRegistry,
    upstreams,
    gatewayAccess,
    logger,
  );
  const management = new ManagementServer(
    config,
    gateway,
    gatewayAccess,
    registry,
    profiles,
    upstreams,
    toolRegistry,
    toolPolicy,
    secrets,
    audit,
    logger,
  );

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("core", `received ${signal}, shutting down`);
    await management.stop().catch((error) => {
      logger.warn("management", `shutdown failed: ${String(error)}`);
    });
    await gateway.stop().catch((error) => {
      logger.warn("gateway", `shutdown failed: ${String(error)}`);
    });
    await upstreams.stopAll();
    await audit.flush();
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
    await gateway.start();
    const activeProfile = profiles.getActive();
    if (activeProfile) {
      const result = await upstreams.applyExactSet(activeProfile.serverIds);
      if (result.failed.length > 0) {
        logger.warn(
          "profiles",
          `active profile restored with ${result.failed.length} failure(s)`,
        );
      }
    } else {
      await upstreams.connectAutoStart();
    }
    logger.info("core", "Core is ready");
  } catch (error) {
    logger.error(
      "core",
      `gateway start failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.warn("core", "Management API remains available for diagnostics");
  }
}

main().catch((error) => {
  console.error("[core] fatal startup failure", error);
  process.exitCode = 1;
});
