import { describe, expect, it } from 'vitest';
import { parseSearch, SEARCH_LIMIT, toGroup } from '../../src/server/search';
import { isSearchShortcut } from '../../src/ui/global-search';

describe('global search query', () => {
  it.each([
    [undefined, '', false],
    ['  Aanya   Sharma ', 'Aanya Sharma', false],
    ['LEAD-000123', 'LEAD-000123', false],
    ['98765 43210', '98765 43210', true],
    ['+91 (98765) 43-210', '+91 (98765) 43-210', true],
    ['4321', '4321', true],
    ['432', '432', false],
    ['parent@example.test', 'parent@example.test', true],
    ['parent@example', 'parent@example', false],
    ['@home', '@home', false],
    ['x'.repeat(150), 'x'.repeat(100), false],
  ])('%j → %j (contact %s)', (raw, text, contact) => {
    expect(parseSearch(raw)).toEqual({ text, contact });
  });

  it('keeps the first SEARCH_LIMIT hits of a group and says when there were more', () => {
    const hit = (i: number) => ({
      id: String(i),
      name: `N${i}`,
      code: null,
      phone: null,
      status: null,
      isSample: false,
    });
    const rows = Array.from({ length: SEARCH_LIMIT + 1 }, (_, i) => hit(i));
    expect(toGroup('leads', rows)).toMatchObject({ key: 'leads', more: true });
    expect(toGroup('leads', rows).hits).toHaveLength(SEARCH_LIMIT);
    expect(toGroup('leads', rows.slice(0, 2))).toEqual({
      key: 'leads',
      hits: rows.slice(0, 2),
      more: false,
    });
  });
});

describe('"/" search shortcut', () => {
  const key = { key: '/', ctrlKey: false, metaKey: false, altKey: false };
  const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });
  it.each([
    [{ ...key, target: el('BODY') }, true],
    [{ ...key, target: el('A') }, true],
    [{ ...key, key: 'k', target: el('BODY') }, false],
    [{ ...key, ctrlKey: true, target: el('BODY') }, false],
    [{ ...key, target: el('INPUT') }, false],
    [{ ...key, target: el('TEXTAREA') }, false],
    [{ ...key, target: el('SELECT') }, false],
    [{ ...key, target: el('DIV', true) }, false],
  ])('%j → %s', (e, expected) => {
    expect(isSearchShortcut(e)).toBe(expected);
  });
});
