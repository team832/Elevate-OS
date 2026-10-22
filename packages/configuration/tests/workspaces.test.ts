import { describe, expect, it } from 'vitest';
import { appOrigin, appOrigins, isAllowedRequestOrigin } from '../src/workspaces';

describe('workspace origins (D-072)', () => {
  it('defaults to the local ports and follows the variables', () => {
    expect([...appOrigins({})]).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ]);
    expect(appOrigin('academic', { ACADEMIC_OS_URL: 'https://academic.example.test/x/' })).toBe(
      'https://academic.example.test',
    );
  });

  const post = (origin?: string) =>
    new Request('http://localhost:3000/ops/api/v1/leads', {
      method: 'POST',
      headers: origin ? { origin } : {},
    });
  it.each([
    [undefined, true],
    ['http://localhost:3000', true],
    ['http://localhost:3002', true],
    ['http://localhost:3003', true],
    ['http://localhost:5173', false],
    ['http://127.0.0.1:3000', false],
    ['null', false],
    ['https://evil.example', false],
  ])('Origin %s → allowed %s', (origin, allowed) => {
    expect(isAllowedRequestOrigin(post(origin), {})).toBe(allowed);
  });
});
