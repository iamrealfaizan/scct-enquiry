/**
 * A fixed-window rate limiter for the public intake endpoint.
 *
 * STATE THE LIMITATION FIRST, because it will be asked about: this counter lives
 * in the memory of one serverless instance. Vercel runs several, and each keeps
 * its own count, so the effective limit is roughly `limit × instances` and it
 * resets whenever an instance recycles. It is a brake on accidental double-posts
 * and casual abuse, not a defence against a distributed attacker.
 *
 * WHY NOT REDIS OR UPSTASH. A shared store would make it exact, at the cost of an
 * external dependency on the critical write path — one more thing that can be
 * down, one more secret, and a "what happens when it is unavailable" answer for a
 * trial with synthetic data. The honest trade for this scope is the in-memory
 * version plus this comment. The pre-production upgrade is in the handoff note.
 *
 * The abuse this actually needs to stop is one person's browser firing the same
 * enquiry five times — and the idempotency key already handles that. This is the
 * second layer.
 */

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

// On globalThis, not module scope: development hot reloads discard module state.
declare global {
  // eslint-disable-next-line no-var
  var _rateLimitBuckets: Map<string, Window> | undefined;
}

const buckets: Map<string, Window> = (global._rateLimitBuckets ??= new Map());

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });

    // Opportunistic sweep, so an instance that has served many distinct clients
    // does not hold their expired windows forever. Cheap, and bounded by the map
    // it is already iterating.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }

    return { allowed: true, remaining: MAX_PER_WINDOW - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  const remaining = Math.max(0, MAX_PER_WINDOW - existing.count);
  const allowed = existing.count <= MAX_PER_WINDOW;

  return {
    allowed,
    remaining,
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-supplied and therefore spoofable — on Vercel the
 * leftmost entry is the real client, but only because the platform sets it. Good
 * enough for a brake; never used for anything security-critical.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `intake:${ip}`;
}
