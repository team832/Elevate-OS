import { describe, expect, it } from 'vitest';
import {
  addDays,
  asId,
  daysBetween,
  err,
  isIsoDate,
  isModuleKey,
  isUuid,
  ok,
  parseIsoDate,
  toIsoDate,
  unwrap,
  type UserId,
} from '../src/index';

describe('ids', () => {
  it('accepts UUIDs and rejects other strings', () => {
    expect(isUuid('d273565f-2ddb-42a5-8a4c-1232b061f4cc')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
    const id: UserId = asId<UserId>('d273565f-2ddb-42a5-8a4c-1232b061f4cc');
    expect(id).toBe('d273565f-2ddb-42a5-8a4c-1232b061f4cc');
    expect(() => asId<UserId>('CLAT-028')).toThrow(TypeError);
  });
});

describe('module keys', () => {
  it('recognises the four zones only', () => {
    expect(isModuleKey('marketing')).toBe(true);
    expect(isModuleKey('finance')).toBe(false);
  });
});

describe('dates (Asia/Kolkata)', () => {
  it('derives the IST calendar date of a UTC instant', () => {
    // 19:00 UTC on 17 Oct is 00:30 IST on 18 Oct.
    expect(toIsoDate(new Date('2026-10-17T19:00:00Z'))).toBe('2026-10-18');
    expect(toIsoDate(new Date('2026-10-17T18:00:00Z'))).toBe('2026-10-17');
  });
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-12-06')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('6 Dec 2026')).toBe(false);
    expect(() => parseIsoDate('2026-13-01')).toThrow(RangeError);
  });
  it('does day arithmetic across month and year boundaries', () => {
    expect(addDays(parseIsoDate('2026-12-30'), 3)).toBe('2027-01-02');
    expect(daysBetween(parseIsoDate('2026-10-17'), parseIsoDate('2026-12-06'))).toBe(50);
  });
});

describe('Result', () => {
  it('unwraps ok and throws on err', () => {
    expect(unwrap(ok(3))).toBe(3);
    expect(() => unwrap(err('boom'))).toThrow('boom');
  });
});
