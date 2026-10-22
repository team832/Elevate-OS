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

  it('joins header and rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
