/**
 * Test default (R15): Academic OS answers the demo-attendance route with "no linked classes", so
 * counsellor marking works in tests that do not simulate Academic. Set directly (not
 * vi.stubGlobal) so `vi.unstubAllGlobals()` in a test restores this default, not the real fetch.
 * Tests that simulate Academic use tests/integration/academic-stub.ts, which replaces it.
 */
const real = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
  /\/academic\/api\/internal\/v1\/demo-attendance\?/.test(String(input))
    ? Response.json({ data: { items: [] } })
    : real(input, init)) as typeof fetch;
