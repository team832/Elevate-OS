/** HUS-004: what a person reads after a refused form, on every route. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodIssues } from '../src/errors';

const schema = z.object({
  title: z.string(),
  name: z.string().min(1),
  note: z.string().max(5),
  code: z.string().min(3),
  count: z.number().max(9),
  least: z.number().min(2),
  id: z.uuid(),
  email: z.email(),
  mode: z.enum(['a', 'b']),
  tags: z.array(z.string()).max(1),
  own: z.string().min(3, { error: 'Give a reason of at least 3 characters.' }),
});

const messages = (input: unknown) =>
  Object.fromEntries(
    zodIssues(schema.safeParse(input).error!, 'body').map((i) => [i.path.join('.'), i.message]),
  );

describe('zodIssues speaks plainly', () => {
  const out = messages({
    name: '',
    note: 'too long',
    code: 'ab',
    count: 10,
    least: 1,
    id: 'BATCH-JULY',
    email: 'nope',
    mode: 'c',
    tags: ['x', 'y'],
    own: 'no',
  });
  it.each([
    ['title', 'This is required.'],
    ['name', 'This is required.'],
    ['note', 'Enter at most 5 characters.'],
    ['code', 'Enter at least 3 characters.'],
    ['count', 'This must be 9 or less.'],
    ['least', 'This must be 2 or more.'],
    ['id', 'Choose from the list.'],
    ['email', 'Enter a valid email address.'],
    ['mode', 'Choose one of the options.'],
    ['tags', 'Choose at most 1.'],
    ['own', 'Give a reason of at least 3 characters.'],
  ])('%s: %s', (field, words) => {
    expect(out[field]).toBe(words);
  });
  it('a number field given text says so', () => {
    expect(messages({ count: 'x' }).count).toBe('Enter a number.');
  });
});
