import { describe, expect, it } from 'vitest';
import { attachmentMime, attachmentProblem, cleanFileName } from '../../src/domain/attachments';

const bytes = (...b: number[]) => Uint8Array.from([...b, 0x20, 0x20, 0x20, 0x20, 0x20]);
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];

describe('attachment type check', () => {
  it.each([
    ['photo.JPG', bytes(0xff, 0xd8, 0xff), null],
    ['photo.webp', bytes(...WEBP), null],
    ['sheet.xlsx', bytes(0x50, 0x4b, 0x03, 0x04), null],
    ['list.csv', new TextEncoder().encode('name,score\nA,1\n'), null],
    ['photo.webp', bytes(0x52, 0x49, 0x46, 0x46), 'not a real'],
    ['sheet.xlsx', bytes(0x4d, 0x5a), 'not a real'],
    ['page.html', bytes(0x3c), 'cannot be uploaded'],
    ['noext', bytes(0x25), 'cannot be uploaded'],
  ])('%s', (name, data, problem) => {
    const result = attachmentProblem(name, attachmentMime(name) ?? 'x', data);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });

  it.each([
    ['C:\\Users\\a\\report.pdf', 'report.pdf'],
    ['../../.env', 'env'],
    ['a<b>:c"|?*.txt', 'abc.txt'],
    ['  two   spaces .pdf ', 'two spaces .pdf'],
    ['\u0000', 'file'],
    [`${'x'.repeat(300)}.pdf`, `${'x'.repeat(251)}.pdf`],
  ])('cleanFileName(%j) = %j', (raw, clean) => expect(cleanFileName(raw)).toBe(clean));
});
