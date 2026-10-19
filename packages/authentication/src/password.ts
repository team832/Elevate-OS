import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Password hashing with scrypt (node:crypto, no native add-ons).
 * Stored format: `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>` so parameters
 * can be raised later; `needsRehash()` tells you when a stored hash is weaker
 * than the current parameters.
 */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;

/** Minimum password length accepted by `hashPassword`. */
export const MIN_PASSWORD_LENGTH = 10;
/** scrypt input is bounded to stop very long passwords being used for DoS. */
export const MAX_PASSWORD_LENGTH = 512;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new RangeError('Password is too long');
  const { N, r, p, keyLength, saltLength } = SCRYPT_PARAMS;
  const salt = randomBytes(saltLength);
  const key = await scrypt(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return null;
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const key = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

/** Constant-time comparison. Returns false for malformed hashes instead of throwing. */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  )
    return false;
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await scrypt(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: 256 * 1024 * 1024,
  });
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

let dummyHash: Promise<string> | undefined;
/**
 * Spend the same time as a real verification when the user does not exist,
 * so response timing does not reveal which emails have accounts.
 */
export async function burnVerificationTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(password || 'x', await dummyHash);
}
