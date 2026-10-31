import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/csv';

describe('CSV export', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['two\nlines', '"two\nlines"'],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+91 text', "'+91 text"],
    ['-cmd', "'-cmd"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tlead', "'\tlead"],
    [null, ''],
    [undefined, ''],
    [-5, '-5'],
    [true, 'true'],
  ] as const)('%j → %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('joins header and rows with CRLF, after a byte order mark so Excel reads UTF-8', async () => {
    const csv = toCsv(['a', 'b'], [[1, 'x,y']]);
    expect(csv).toBe('﻿a,b\r\n1,"x,y"\r\n');
    const bytes = new Uint8Array(await new Response(toCsv(['नाम ₹'], [])).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
