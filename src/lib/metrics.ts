/**
 * Idempotent metric registration.
 *
 * prom-client keeps one process-global `Registry`, and its constructors throw on
 * a duplicate name. That is normally what you want, but this codebase evaluates
 * more than one copy of a given module in a single process: the OTel preload
 * (`dist/instrumentation.mjs`, an esbuild bundle loaded with `--import`) and the
 * app bundle each contain their own copy of `observe.ts`, because the preload has
 * to exist before Astro's entry module is evaluated. Two copies means two
 * registrations of the same metric name, and the second one throws — which takes
 * the whole app down at boot with `A metric with the name ... has already been
 * registered`.
 *
 * The fix is to treat the registry as the source of truth for "does this metric
 * exist" rather than module state, so re-evaluating a module is a no-op instead of
 * a crash. `globalThis` rather than a module-level flag for the same reason: the
 * duplicate copies do not share module scope, but they do share globals.
 */
import promClient from 'prom-client';

const g = globalThis as {
  /** Set once per process, by whichever copy of observe.ts evaluates first. */
  __fossDefaultMetricsCollected?: boolean;
  __fossPromRegistry?: promClient.Registry;
};

export const register: promClient.Registry = g.__fossPromRegistry ?? promClient.register;
if (!g.__fossPromRegistry) g.__fossPromRegistry = register;

interface CounterConfig {
  name: string;
  help: string;
  labelNames?: readonly string[];
}

/** `foss_`-prefixed node/process metrics. Safe to call from every copy. */
export function collectDefaultMetricsOnce(): void {
  if (g.__fossDefaultMetricsCollected) return;
  g.__fossDefaultMetricsCollected = true;
  promClient.collectDefaultMetrics?.({ prefix: 'foss_', register });
}

export function counterOrGet(config: CounterConfig): promClient.Counter<string> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as promClient.Counter<string>;
  return new promClient.Counter({
    ...config,
    // `[]`, never `undefined`. prom-client's `Metric.reset()` reads
    // `this.labelNames.length` unconditionally, so a label-less counter built
    // with an absent `labelNames` throws on construction rather than at call
    // time. Declaring "no labels" explicitly is also what prom-client expects.
    labelNames: config.labelNames ? [...config.labelNames] : [],
    registers: [register],
  });
}

interface HistogramConfig extends CounterConfig {
  buckets?: readonly number[];
}

export function histogramOrGet(config: HistogramConfig): promClient.Histogram<string> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as promClient.Histogram<string>;
  return new promClient.Histogram({
    ...config,
    labelNames: config.labelNames ? [...config.labelNames] : undefined,
    buckets: config.buckets ? [...config.buckets] : undefined,
    registers: [register],
  });
}
