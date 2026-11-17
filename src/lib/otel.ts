/**
 * OpenTelemetry bootstrap (opt-in, zero cost when off).
 *
 * Local: `docker compose --profile infra up -d` starts `alloy`, which receives
 * OTLP over HTTP and forwards to Tempo. The SDK is only loaded when tracing is
 * actually enabled, so a deployment without a collector pays nothing.
 *
 * Production: point `OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP/HTTP collector
 * and the same code path works unchanged. Never import the SDK statically here —
 * that defeats the "no collector, no cost" contract.
 *
 * Callers: `instrumentation.ts` (preloaded via `NODE_OPTIONS=--import`, the only
 * place the HTTP server instrumentation can patch `node:http`) and
 * `src/middleware.ts` (covers `astro dev`, where no preload is configured).
 *
 * See plan/core-architecture/32-observability-and-telemetry-stack.md
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/** Single probe, ~300ms worst case, only ever paid when OTEL_ENABLED=auto. */
async function otlpReachable(endpoint: string): Promise<boolean> {
  try {
    await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'GET',
      signal: AbortSignal.timeout(300),
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveEnabled(endpoint: string): Promise<boolean> {
  const flag = (process.env.OTEL_ENABLED ?? 'auto').toLowerCase();
  if (TRUTHY.has(flag)) return true;
  if (FALSY.has(flag)) return false;
  // auto: trace only when a collector is actually listening, so `--profile infra`
  // is all it takes locally and a bare `up` stays silent instead of erroring.
  return endpoint !== '' && (await otlpReachable(endpoint));
}

async function start(): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
  if (!(await resolveEnabled(endpoint))) return;

  const [sdk, resources, exporter, http, pg, undici, ioredis] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-pg'),
    import('@opentelemetry/instrumentation-undici'),
    import('@opentelemetry/instrumentation-ioredis'),
  ]);

  const samplerArg = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? '1');
  const ratio = Number.isFinite(samplerArg) ? samplerArg : 1;

  new sdk.NodeSDK({
    resource: resources.resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'mechanical-matter',
      'service.namespace': 'mechanical-matter',
      'service.version': process.env.APP_VERSION ?? '0.0.1',
      'deployment.environment': process.env.DEPLOY_ENV ?? process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new exporter.OTLPTraceExporter({
      url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
    }),
    sampler: new sdk.tracing.ParentBasedSampler({
      root: new sdk.tracing.TraceIdRatioBasedSampler(ratio),
    }),
    instrumentations: [
      new http.HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url?.startsWith('/api/v1/health') === true,
      }),
      new pg.PgInstrumentation(),
      new undici.UndiciInstrumentation(),
      new ioredis.IORedisInstrumentation(),
    ],
  }).start();
}

let pending: Promise<void> | null = null;

/**
 * Idempotent. Awaited by the preload and by the first request, so no span is
 * ever emitted before the SDK is live.
 */
export function ensureOtel(): Promise<void> {
  if (pending) return pending;
  pending = start().catch((err: unknown) => {
    pending = null;
    console.error('[otel] tracing disabled — bootstrap failed:', err);
  });
  return pending;
}
