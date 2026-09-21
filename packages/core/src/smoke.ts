const host = process.env.MCP_GATE_HOST ?? "127.0.0.1";
const port = process.env.MCP_GATE_PORT ?? "24888";
const url = `http://${host}:${port}/ping`;

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  console.log(
    JSON.stringify({
      ok: response.ok,
      status: response.status,
      url,
    }),
  );
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, url, error: String(error) }));
  process.exit(1);
}
