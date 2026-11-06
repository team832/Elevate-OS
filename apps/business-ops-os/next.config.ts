import { zoneConfig } from '@elevate/configuration/next-config';

/** Business Ops OS lives under /ops. */
export default zoneConfig({ basePath: '/ops', env: { ELEVATE_BASE_PATH: '/ops' } });
