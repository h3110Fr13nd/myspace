/**
 * Central environment accessors for optional services and feature flags.
 * Defaults and dependency fallbacks are documented beside each setting.
 */
import 'dotenv/config';

function bool(value: string | undefined, dflt = false): boolean {
  if (value === undefined || value === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  /** redis url; when unreachable, cache/queue/sessions degrade to no-op */
  redisUrl: process.env.REDIS_URL || '',
  /** Redis session store (revocation denylist + rotation). Default off. */
  sessionStore: process.env.AUTH_SESSION_STORE || '',
  /** Enable BullMQ queue + worker. Default off (synchronous fallback). */
  queue: bool(process.env.QUEUE_ENABLED),
  /** Enable rate limiting middleware. Default off for local dev comfort. */
  rateLimit: bool(process.env.RATE_LIMIT_ENABLED),
  /** Per-IP auth limiter (default off). */
  rateLimitAuth: bool(process.env.RATE_LIMIT_AUTH),
  /** Append security headers. Default off (CSP is deferred — see plan). */
  securityHeaders: bool(process.env.SECURITY_HEADERS),
  /** Write audit rows. Default on (cheap, single insert). */
  audit: bool(process.env.AUDIT_ENABLED, true),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
} as const;
