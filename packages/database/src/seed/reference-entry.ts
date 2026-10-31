/**
 * What reference seeds may use. The release bundler maps `@elevate/database/seed` to this file, so
 * db/seed-reference.mjs cannot contain the sample users or the demo accounts of the full barrel.
 */
export * from './registry';
export * from './core-reference';
export * from './staff-history';
