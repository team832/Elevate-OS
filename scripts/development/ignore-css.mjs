// `npm run db:seed` reaches screen modules through `@elevate/business-ops-os/work` and `/leads`
// (D-073); plain Node cannot load their `.css` imports, so they load as empty modules here.
// `--tsconfig tsconfig.base.json` beside it gives those `.tsx` files the automatic JSX runtime.
import { registerHooks } from 'node:module';

registerHooks({
  load: (url, context, next) =>
    url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context),
});
