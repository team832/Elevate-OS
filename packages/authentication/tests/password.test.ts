import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/password';

describe('scrypt password hashing', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterY', a)).toBe(false);
  });

  it('rejects short passwords at hashing time', async () => {
    await expect(hashPassword('short')).rejects.toThrow(RangeError);
  });

  it('returns false (not throw) for malformed or missing hashes', async () => {
    expect(await verifyPassword('whatever-long', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('whatever-long', null)).toBe(false);
    expect(await verifyPassword('', await hashPassword('something long'))).toBe(false);
  });

  it('flags weaker parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('something long'))).toBe(false);
    expect(needsRehash('scrypt$1024$8$1$c2FsdA$a2V5')).toBe(true);
  });
});
