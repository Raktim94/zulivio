import { BadRequestException } from "@nestjs/common";
import dns from "node:dns";
import { isIP } from "node:net";

/** Self-hosters whose receiver lives on their own LAN can opt in; the default is the safe one. */
export const allowPrivateNetworks = () => process.env.WEBHOOKS_ALLOW_PRIVATE_NETWORKS === "true";
export const allowPlainHttp = () => process.env.WEBHOOKS_ALLOW_HTTP === "true";

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||            // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                               // multicast, reserved, broadcast
  );
}

/** True for any address a server-side request must not be pointed at by default. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return v4Private(mapped[1]);
    return (
      lower === "::" || lower === "::1" ||
      lower.startsWith("fc") || lower.startsWith("fd") ||   // unique local
      /^fe[89ab]/.test(lower) ||                            // link-local
      lower.startsWith("ff")                                // multicast
    );
  }
  return true; // not an IP at all: refuse
}

/** Cheap, synchronous checks that don't need DNS. Throws a 400 with a user-facing reason. */
export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowPlainHttp())) {
    throw new BadRequestException("Webhook URLs must use https://.");
  }
  if (url.username || url.password) throw new BadRequestException("Put credentials in the signing secret, not in the URL.");
  if (raw.length > 2000) throw new BadRequestException("URL is too long.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivateNetworks()) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      throw new BadRequestException("That address is on a private network. Use a public https:// address.");
    }
    if (isIP(host) && isPrivateAddress(host)) {
      throw new BadRequestException("That address is on a private network. Use a public https:// address.");
    }
  }
  return url;
}

/** Registration-time check: syntax plus every address the name resolves to. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  const url = parseWebhookUrl(raw);
  if (allowPrivateNetworks()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return url;
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new BadRequestException("That host name could not be resolved.");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new BadRequestException("That address resolves to a private network. Use a public https:// address.");
  }
  return url;
}

/**
 * `lookup` hook for http(s).request: the connection is made to the address this
 * returns, so the check and the connection can't disagree (no DNS rebinding
 * between "validated at registration" and "connected at delivery").
 */
export const safeLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;
  const opts = (typeof options === "object" && options !== null ? options : {}) as dns.LookupOptions;
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs;
    const bad = !allowPrivateNetworks() && list.some((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return cb(new Error("BLOCKED_ADDRESS"));
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;
