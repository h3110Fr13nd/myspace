/**
 * OTel preload. Bundled to `dist/instrumentation.mjs` at image build time and
 * loaded with `NODE_OPTIONS=--import`, which is the only point at which the HTTP
 * server instrumentation can patch `node:http` before Astro's entry module
 * creates a server. `src/middleware.ts` calls the same `ensureOtel()` for
 * `astro dev`, where nothing is preloaded.
 *
 * Do not add app logic here — this runs before the app, not instead of it.
 */
import { ensureOtel } from './src/lib/otel';
import { installProcessErrorHandlers } from './src/lib/processErrors';

installProcessErrorHandlers();
await ensureOtel();
