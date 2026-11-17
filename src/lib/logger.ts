/**
 * Structured JSON logging via pino.
 * The shared logger is used across routes and middleware; request handlers
 * should not construct a new logger wrapper for every request.
 */
import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { config } from './config';

/**
 * W3C trace/span ids on every line. Absent when tracing is off, so this costs
 * nothing until a collector exists — and Loki's `derivedFields` can turn any
 * line into a Tempo trace link the moment one does.
 */
function traceContext(): Record<string, string> {
  const sc = trace.getActiveSpan()?.spanContext();
  if (!sc || !trace.isSpanContextValid(sc)) return {};
  return { trace_id: sc.traceId, span_id: sc.spanId };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  mixin: traceContext,
  base: {
    service: 'mechanical-matter',
    env: config.nodeEnv,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

export function childLogger(binding: Record<string, unknown>) {
  return logger.child(binding);
}
