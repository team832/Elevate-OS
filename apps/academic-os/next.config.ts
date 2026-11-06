import { zoneConfig } from '@elevate/configuration/next-config';

/** Academic OS lives under /academic. */
export default zoneConfig({
  basePath: '/academic',
  env: { ELEVATE_BASE_PATH: '/academic' },
  // Shared task/EOD screens from Business Ops' entry points (D-073).
  transpilePackages: ['@elevate/business-ops-os'],
});
