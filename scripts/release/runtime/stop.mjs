/** Source of bin/stop.mjs: stops what bin/start.mjs started, on Windows and on Linux. */
import { readPids, stopAll } from './common.mjs';

if (Object.keys(readPids()).length === 0) console.log('Nothing to stop.');
else if (!(await stopAll())) process.exitCode = 1;
