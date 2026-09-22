import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const MANAGEMENT_TOKEN_HEADER = "x-mcp-gate-token";
export const DESKTOP_CLIENT_HEADER = "x-mcp-gate-client";

export function isManagementRequestAuthorized(
  headers: IncomingHttpHeaders,
  expectedToken: string | null,
): boolean {
  if (expectedToken) {
    const supplied = readHeader(headers[MANAGEMENT_TOKEN_HEADER]);
    return supplied !== null && constantTimeEqual(supplied, expectedToken);
  }

  return readHeader(headers[DESKTOP_CLIENT_HEADER]) === "desktop";
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    // Perform a comparison anyway so the mismatch path does not immediately return.
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
