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

/** Expand an IPv6 literal (any valid textual form) to 8 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const groups = all.map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address a server-side request must not be pointed at by default. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return v4Private(ip);
  if (v === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true; // unparseable: refuse
    const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
    // IPv4 embedded in IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d),
    // NAT64 (64:ff9b::/96) and 6to4 (2002:AABB:CCDD::/16). Judge the embedded v4 address.
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
      if (g5 === 0 && g6 === 0 && g7 <= 1) return true; // :: and ::1
      return v4Private(v4From(g6, g7));
    }
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4Private(v4From(g6, g7));
    if (g0 === 0x2002) return v4Private(v4From(g1, g2));
    return (
      (g0 & 0xfe00) === 0xfc00 ||             // unique local fc00::/7
      (g0 & 0xffc0) === 0xfe80 ||             // link-local fe80::/10
      (g0 & 0xffc0) === 0xfec0 ||             // site-local fec0::/10 (deprecated)
      (g0 & 0xff00) === 0xff00 ||             // multicast
      (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard 100::/64
      (g0 === 0x2001 && g1 === 0xdb8)         // documentation
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
