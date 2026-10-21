import { describe, expect, it } from 'vitest';
import { inOrder } from '../../src/server/ops-common';

describe('inOrder (one query at a time on a transaction client)', () => {
  it('starts each item only after the previous one finished, thunks included', async () => {
    const log: string[] = [];
    const lazy = (name: string) => ({
      then: (resolve: (v: string) => void) => {
        log.push(`start ${name}`);
        setTimeout(() => (log.push(`end ${name}`), resolve(name)), 5);
      },
    });
    const thunk = () => (log.push('start c'), Promise.resolve(3));
    expect(await inOrder([lazy('a'), lazy('b'), thunk])).toEqual(['a', 'b', 3]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c']);
  });
});
