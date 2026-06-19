/**
 * URL Security Policy (SSRF Protection)
 *
 * Prevents `read` tool from being used to probe internal networks
 * (loopback, link-local, private RFC1918 ranges, IPv6 ULAs, etc.)
 * or to fetch cloud-metadata endpoints (e.g. 169.254.169.254).
 *
 * Opt-in to allow private URLs by setting `MCP_HTTP_ALLOW_PRIVATE_URLS=true`
 * (intended for trusted local development only).
 *
 * Defense layers:
 *   1. Literal hostname check (cheap, fast) - reject obvious private/loopback names
 *   2. Numeric IP literal check (v4 + v6) - reject private/link-local/loopback addresses
 *   3. DNS-resolution enforcement happens inside the fetch dispatcher
 *      (private answers throw URL_SECURITY_POLICY_DNS_ERROR)
 *
 * This is the agent-search port of the upstream mcp-searxng 1.7.1 fix for
 * GHSA-mrvx-jmjw-vggc, simplified to remove the dependency on
 * http-security.ts and the broader MCP hardening surface.
 */

import { isIP } from "node:net";
import { createURLSecurityPolicyError } from "./error-handler.js";

export const URL_SECURITY_POLICY_DNS_ERROR = "URLSecurityPolicyDnsError";

/**
 * Read the opt-in flag that lets `read` fetch private/loopback URLs.
 * Defaults to `false` (block). When `true`, all asserts become no-ops.
 */
function isAllowPrivateUrlsEnabled(): boolean {
  return process.env.MCP_HTTP_ALLOW_PRIVATE_URLS === "true";
}

export function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.+$/, "");
  return lower === "localhost" || lower.endsWith(".localhost");
}

export function isPrivateIpv4(hostname: string): boolean {
  if (isIP(hostname) !== 4) {
    return false;
  }

  return (
    hostname.startsWith("0.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    hostname.startsWith("169.254.")
  );
}

export function isPrivateIPv6(hostname: string): boolean {
  // url.hostname wraps IPv6 in brackets (e.g. "[::1]") - strip them first
  const addr = (hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  ).toLowerCase();

  if (isIP(addr) !== 6) return false;

  if (addr === "::1") return true;                     // loopback
  if (addr === "::") return true;                      // unspecified
  if (/^f[cd]/i.test(addr)) return true;               // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true;  // link-local fe80::/10

  // IPv4-mapped ::ffff:<ipv4> - delegate to the IPv4 check
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  // IPv4-mapped ::ffff:<hhhh>:<hhhh> - convert the hex segments to dotted decimal
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    const ipv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    return isPrivateIpv4(ipv4);
  }

  return false;
}

export function isPrivateAddress(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIPv6(address);
}

/**
 * Throw a `MCPSearXNGError` if the URL resolves to a private/loopback address.
 * No-op when `MCP_HTTP_ALLOW_PRIVATE_URLS=true`.
 *
 * Called after parsing the user-supplied URL and on every redirect target.
 */
export function assertUrlAllowed(url: URL): void {
  if (isAllowPrivateUrlsEnabled()) {
    return;
  }

  if (isPrivateHostname(url.hostname) || isPrivateIpv4(url.hostname) || isPrivateIPv6(url.hostname)) {
    throw createURLSecurityPolicyError(url.toString());
  }
}

/**
 * Build a tagged `ErrnoException` indicating a private address was rejected
 * after DNS resolution. The fetch dispatcher throws these so the URL reader
 * can map them back to a user-facing security error.
 */
export function createUrlSecurityPolicyDnsError(hostname: string): NodeJS.ErrnoException {
  const error = new Error(`Resolved private address blocked by security policy for ${hostname}`) as NodeJS.ErrnoException;
  error.name = URL_SECURITY_POLICY_DNS_ERROR;
  error.code = URL_SECURITY_POLICY_DNS_ERROR;
  return error;
}

/**
 * Walks the error chain (including AggregateError `errors[]`) to detect
 * DNS-resolved private-address rejections thrown by the dispatcher.
 */
export function isUrlSecurityPolicyDnsError(error: unknown): boolean {
  let current = error as any;
  while (current) {
    if (current.name === URL_SECURITY_POLICY_DNS_ERROR || current.code === URL_SECURITY_POLICY_DNS_ERROR) {
      return true;
    }
    if (Array.isArray(current.errors) && current.errors.some(isUrlSecurityPolicyDnsError)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
