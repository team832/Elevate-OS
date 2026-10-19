/**
 * Marketing OS server layer — services (transactions, permission checks, audit),
 * repositories and adapters. Exported as `@elevate/marketing-os/server` for the platform
 * app and wave-3 integration tests. Other MODULES must never import it (D-011.3).
 */
export { MODULE_PATHS } from './paths';
export { authOptions } from './auth';
export * from './access';
export * from './policy';
export * from './codes';
export * from './accounts';
export * from './ideas';
export * from './rules';
export * from './content';
export * from './content-queries';
export * from './placements';
export * from './groups';
export * from './metrics';
export * from './reports';
export * from './summary';
export * from './dashboard';
export * from './legacy';
export {
  MockPublishingAdapter,
  DisabledPublishingAdapter,
  getPublishingAdapter,
  setPublishingAdapterForTesting,
  type PublishingAdapter,
  type PublishRequest,
  type PublishResult,
} from './adapters/publishing';
