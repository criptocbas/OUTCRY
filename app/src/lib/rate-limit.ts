/**
 * Simple in-memory rate limiter for API routes.
 * Token bucket per IP: allows `limit` requests per `windowMs` window.
 */

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

export function rateLimit(
  ip: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.lastRefill > windowMs) {
    buckets.set(ip, { tokens: limit - 1, lastRefill: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (bucket.tokens <= 0) {
    return { allowed: false, remaining: 0 };
  }

  bucket.tokens -= 1;
  return { allowed: true, remaining: bucket.tokens };
}

// Periodic cleanup to prevent memory leak (runs every 5 minutes)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (now - bucket.lastRefill > DEFAULT_WINDOW_MS * 2) {
        buckets.delete(ip);
      }
    }
  }, 300_000);
}
