import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto (no native modules to build).
 *
 * Stored format: `scrypt$N=32768,r=8,p=1$<salt base64>$<hash base64>`. The parameters travel
 * with each hash, so they can be raised later without breaking existing accounts.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, KEY_BYTES, PARAMS);
  const params = `N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}`;
  return ['scrypt', params, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** True when `password` matches `stored`. Malformed hashes never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const hash = await derive(password, parsed.salt, parsed.hash.length, parsed.params);
  return timingSafeEqual(hash, parsed.hash);
}

/**
 * A real hash of a throwaway password. Login checks unknown emails against it so they take as
 * long as wrong passwords, and response timing can't reveal who has an account.
 */
export const DUMMY_HASH: Promise<string> = hashPassword(randomBytes(16).toString('hex'));

function parse(stored: string) {
  const [algorithm, paramList, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !paramList || !salt || !hash) return null;
  const params = Object.fromEntries(paramList.split(',').map((kv) => kv.split('=')));
  const N = Number(params.N);
  const r = Number(params.r);
  const p = Number(params.p);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  return { params: { N, r, p }, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

function derive(password: string, salt: Buffer, length: number, { N, r, p }: typeof PARAMS): Promise<Buffer> {
  // scrypt needs 128 * N * r bytes; allow twice that so Node's 32 MiB default isn't the limit.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
