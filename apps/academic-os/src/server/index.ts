/**
 * Academic OS server layer — services (transactions, permission checks, audit),
 * repositories and adapters. Exported as `@elevate/academic-os/server` for the platform
 * app and wave-3 integration tests. Other MODULES must never import it (D-011.3).
 */
export { MODULE_PATHS } from './paths';
export { authOptions } from './auth';
export * from './context';
export * from './services/curriculum';
export * from './services/batches';
export * from './services/timetable';
export * from './services/teaching';
export * from './services/assessments';
export * from './services/results';
export * from './services/students';
export * from './services/progress';
export * from './services/intake';
export * from './services/summary';
export * from './services/settings';
