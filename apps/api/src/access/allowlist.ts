// Private access: who may reach the site while it's switched on. Plain functions over IP strings,
// shared by the API's guard (AccessService) and the Vercel middleware that guards the pages (gate.ts).
import { BlockList, isIP } from 'node:net';

/** An allowlist entry: a label is up to this long. */
export const ALLOWLIST_LABEL_MAX = 60;

/** "::ffff:203.0.113.7" → "203.0.113.7", IPv6 lowercased; null for anything that isn't an address. */
export function normalizeIp(raw: string | null | undefined): string | null {
  const ip = raw?.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '') ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  return isIP(ip) ? ip : null;
}

/**
 * An entry as staff type it: an address ("203.0.113.7") or a range in CIDR notation
 * ("203.0.113.0/24", "2001:db8:1:2::/64"). Returns it tidied up, or null when it's neither.
 * A range as wide as a single address is stored as that address.
 */
export function parseEntry(raw: string): string | null {
  const [addr, prefix, extra] = raw.trim().split('/');
  if (extra !== undefined) return null;
  const ip = normalizeIp(addr);
  if (!ip) return null;
  if (prefix === undefined) return ip;
  const bits = isIP(ip) === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > bits) return null;
  return Number(prefix) === bits ? ip : `${ip}/${Number(prefix)}`;
}

/** Whether `ip` is on the list. Entries that don't parse are skipped. */
export function allowlist(entries: readonly string[]): (ip: string | null) => boolean {
  const list = new BlockList();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed) continue;
    const [addr, prefix] = parsed.split('/');
    const family = isIP(addr) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(addr, family);
    else list.addSubnet(addr, Number(prefix), family);
  }
  return (ip) => {
    const address = normalizeIp(ip);
    return !!address && list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  };
}

/**
 * The entry that lets someone in from where they are now: an IPv4 address as it is, an IPv6
 * address as its /64, the home network's range, because devices change their own IPv6 address
 * within it every day or so (privacy addresses).
 */
export function ownEntry(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`;
}

/** "2001:db8::1" → ["2001", "db8", "0", "0", "0", "0", "0", "1"]. */
function expandIpv6(ip: string): string[] {
  let text = ip;
  // a dotted IPv4 tail ("64:ff9b::192.0.2.1") is the last two groups
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const zeros = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((g) => g.replace(/^0+(?=.)/, ''));
}
