import { zoneConfig } from '@elevate/configuration/next-config';

/** Marketing OS lives under /marketing. */
export default zoneConfig({
  basePath: '/marketing',
  env: { ELEVATE_BASE_PATH: '/marketing' },
  // Shared task/EOD and lead screens from Business Ops' entry points (D-073).
  transpilePackages: ['@elevate/business-ops-os'],
  // Metrics CSV exports are posted to a server action; allow up to 5 MB.
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
});
