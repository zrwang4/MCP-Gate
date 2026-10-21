export const SERVER_ORDER_KEY = "mcp-gate.server-display-order.v1";

export function parseServerOrder(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function orderServers<T extends { id: string }>(servers: T[], order: string[]): T[] {
  const remaining = new Map(servers.map((server) => [server.id, server]));
  const sorted: T[] = [];
  for (const id of order) {
    const server = remaining.get(id);
    if (server) {
      sorted.push(server);
      remaining.delete(id);
    }
  }
  return [...sorted, ...remaining.values()];
}

export function moveServer(order: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
  return next;
}
