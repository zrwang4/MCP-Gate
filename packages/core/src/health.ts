import type { CoreConfig } from "./config.ts";

export async function waitForGateway(
  config: CoreConfig,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${config.host}:${config.port}/ping`;

  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Gateway did not become ready: ${String(lastError)}`);
}
