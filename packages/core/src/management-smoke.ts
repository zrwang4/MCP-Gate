const baseUrl = process.env.MCP_GATE_MANAGEMENT_URL ?? "http://127.0.0.1:24889";

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const [health, status, servers, logs] = await Promise.all([
  get("/api/health"),
  get("/api/status"),
  get("/api/servers"),
  get("/api/logs?limit=5"),
]);

console.log(JSON.stringify({ health, status, servers, logs }, null, 2));
