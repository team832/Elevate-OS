/**
 * REV-1 D1: route input reaches the handler with every UUID-shaped value in lower case; keys,
 * secrets and everything else arrive as sent (FR-A M3).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Database } from '@elevate/database';
import { buildRequest, callRoute } from '@elevate/testing';
import { defineInternalWriteRoute, defineRoute } from '../src/index';

const ID = '0b6f8f2e-3c1a-4f7e-9b2d-1a2b3c4d5e6f';
const UP = ID.toUpperCase();
const noDb = { getDb: () => ({}) as Database };
const idOf = z.object({ id: z.string() });
const input = (v: string, key: string) => ({
  id: v,
  rows: [{ ids: [v, 'Sample'] }],
  byId: { [key]: 1, [key.toLowerCase()]: 2 },
});

const routes = [
  [
    'defineRoute',
    defineRoute(
      { permission: 'public', params: idOf, query: idOf, body: z.unknown() },
      async ({ params, query, body }) => ({ params, query, body }),
      noDb,
    ),
  ],
  [
    'defineInternalWriteRoute',
    defineInternalWriteRoute(
      { callers: ['ops'], params: idOf, query: idOf, body: z.unknown() },
      async ({ params, query, body, actingUserId }) => ({ params, query, body, actingUserId }),
      noDb,
    ),
  ],
] as const;

const internalHeaders = {
  authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
  'x-elevate-caller': 'ops',
  'x-elevate-acting-user': UP,
};

describe.each(routes)('%s', (name, route) => {
  it.each([
    ['an upper-case uuid is lower-cased', UP, ID],
    ['a mixed-case uuid is lower-cased', '0B6f8F2E-3c1A-4f7e-9B2d-1a2b3C4D5e6F', ID],
    ['text with capitals is unchanged', 'Sample Staff ABC', 'Sample Staff ABC'],
    ['a 35-character near-uuid is unchanged', UP.slice(1), UP.slice(1)],
    ['a 37-character near-uuid is unchanged', `${UP}A`, `${UP}A`],
  ])('%s in params, query, body and nested arrays; keys stay as sent', async (_, sent, seen) => {
    const res = await callRoute<Record<string, unknown>>(
      route,
      buildRequest(`/ops/api/v1/x/${sent}?id=${sent}`, {
        json: input(sent, sent),
        headers: name === 'defineRoute' ? {} : internalHeaders,
      }),
      { id: sent },
    );
    expect(res.data).toMatchObject({
      params: { id: seen },
      query: { id: seen },
      body: input(seen, sent),
    });
    if (name !== 'defineRoute') expect(res.data!.actingUserId).toBe(ID);
  });

  it.each([
    ['staffId', ID],
    ['password', UP],
    ['newPasscode', UP],
    ['clientSecret', UP],
    ['resetToken', UP],
    ['code', UP],
    ['setupCode', UP],
    ['pin', UP],
    ['otp', UP],
    ['apiKey', UP],
    ['api_key', UP],
  ])('an upper-case uuid under %s, nested, arrives as %s', async (key, seen) => {
    const json = (v: string) => ({ rows: [{ [key]: v }] });
    const res = await callRoute<{ body: unknown }>(
      route,
      buildRequest('/ops/api/v1/x/a?id=a', {
        json: json(UP),
        headers: name === 'defineRoute' ? {} : internalHeaders,
      }),
      { id: 'a' },
    );
    expect(res.data!.body).toEqual(json(seen));
  });
});
