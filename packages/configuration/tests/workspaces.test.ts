import { describe, expect, it } from 'vitest';
import { appOrigin, appOrigins, isAllowedActionOrigin, isAllowedRequestOrigin } from '../src/workspaces';

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

  // Next rebuilds request.url from its own hostname, so only Host shows the address the person really opened (FEE-004).
  it.each([
    ['http://127.0.0.1:3000', '127.0.0.1:3000', true],
    ['http://10.2.0.2:3000', '10.2.0.2:3000', true],
    ['http://127.0.0.1:5173', '127.0.0.1:3000', false],
    ['https://evil.example', '127.0.0.1:3000', false],
    ['null', 'null', false],
  ])('Origin %s on Host %s → allowed %s', (origin, host, allowed) => {
    const request = new Request('http://localhost:3000/ops/api/v1/leads', {
      method: 'POST',
      headers: { origin, host },
    });
    expect(isAllowedRequestOrigin(request, {})).toBe(allowed);
  });

  // The rule Next applies to a server action, which it answers with a 500 and a logged stack (RVA-004).
  it.each([
    [null, 'localhost:3002', undefined, true],
    ['http://localhost:3002', 'localhost:3002', undefined, true],
    ['http://10.2.0.2:3002', '10.2.0.2:3002', undefined, true],
    ['http://localhost:3003', 'localhost:3002', undefined, true],
    ['http://localhost:3003', 'localhost:3002', 'localhost:3003', true],
    ['http://localhost:3000', 'localhost:3002', undefined, false],
    ['http://localhost:3002', 'localhost:3002', 'localhost:3003', false],
    ['https://evil.example', 'localhost:3002', undefined, false],
    ['null', 'localhost:3002', undefined, false],
  ])('server action: Origin %s on Host %s, forwarded %s → allowed %s', (origin, host, forwarded, allowed) => {
    const headers = new Headers({ host });
    if (origin) headers.set('origin', origin);
    if (forwarded) headers.set('x-forwarded-host', forwarded);
    expect(isAllowedActionOrigin({ headers }, {})).toBe(allowed);
  });
});
