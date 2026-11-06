import { zoneConfig } from '@elevate/configuration/next-config';
import { securityHeaders } from '@elevate/configuration/security-headers';
import { appOrigin } from '@elevate/configuration/workspaces';

export default zoneConfig({
  env: { ELEVATE_BASE_PATH: '' },
  async headers() {
    return [
      // Module zones are excluded: their own app sets these headers and its CSP (src/proxy.ts).
      {
        source: '/((?!marketing(?:/|$)|academic(?:/|$)|ops(?:/|$)).*)',
        headers: securityHeaders(),
      },
      // These stay here (see rewrites), so the 404 is ours and needs the headers.
      {
        source: '/:zone(marketing|academic|ops)/api/internal/:rest*',
        headers: securityHeaders(),
      },
    ];
  },
  // The overview reads the modules' server services with the signed-in user
  // (apps/platform/src/server/overview-adapter.ts); only their ./server entries are imported.
  transpilePackages: ['@elevate/business-ops-os', '@elevate/academic-os', '@elevate/marketing-os'],
  /**
   * Multi-zone routing (D-004): the platform serves `/`, and forwards each
   * module's base path to its own app. The browser stays on this origin, so
   * the `elevate_session` cookie reaches every zone. Rewrites are resolved at
   * build/start time from the *_OS_URL variables. /<zone>/api/internal/** is not forwarded:
   * servers call it on the zone's own origin, so it never sits on the public host.
   */
  async rewrites() {
    const path = ':path((?!api/internal(?:/|$)).+)';
    return (['marketing', 'academic', 'ops'] as const).flatMap((zone) => [
      { source: `/${zone}`, destination: `${appOrigin(zone)}/${zone}` },
      { source: `/${zone}/${path}`, destination: `${appOrigin(zone)}/${zone}/:path` },
    ]);
  },
});
