/**
 * Validation for the static request headers configured on an HTTP upstream.
 *
 * The rules live here rather than inside the registry because three callers
 * need identical behaviour: the registry when a config is saved, the
 * connection test when it builds a throwaway client, and the management route
 * when it parses a request body. Keeping three copies in sync by hand is how a
 * header that saves successfully ends up failing the test.
 *
 * The env-var validator in server-registry is deliberately stricter (no
 * hyphens) and is not reusable here — `X-Apifox-Api-Version` is a perfectly
 * legal header name.
 */

const MAX_HEADERS = 64;
const MAX_NAME_LENGTH = 256;
const MAX_VALUE_LENGTH = 16_384;

/** RFC 7230 token: no separators, no control characters, hyphens allowed. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function validateHeaders(
  values: unknown,
): Record<string, string> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("headers must be an object");
  }

  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) throw new Error("too many headers");

  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key.length > MAX_NAME_LENGTH || !TOKEN.test(key)) {
      throw new Error(`invalid HTTP header name: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`header ${key} must be a string`);
    }
    if (value.length > MAX_VALUE_LENGTH) {
      throw new Error(`header ${key} is too long`);
    }
    // A CR or LF here lets a caller inject arbitrary request headers.
    if (/[\r\n]/.test(value)) throw new Error(`header ${key} contains a newline`);
    result[key] = value;
  }
  return result;
}

/**
 * Same rules, but an absent key returns undefined so a caller can tell "not
 * supplied" apart from "supplied as empty, which clears the stored headers".
 */
export function readOptionalHeaders(
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  return validateHeaders(value);
}
