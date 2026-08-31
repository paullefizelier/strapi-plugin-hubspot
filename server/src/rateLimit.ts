/**
 * In-memory sliding-window rate limiter for the public routes. Per-process on
 * purpose: a form submission endpoint needs a cheap brake against a single
 * abusive IP, not distributed accounting — and a multi-instance deployment
 * simply multiplies the budget by the instance count, which is fine.
 */

export interface Limiter {
  /** True when the call fits the window; false = refuse (429). */
  allow(key: string): boolean;
  /** Number of tracked keys — a test hook for the sweep. */
  size(): number;
}

export function createLimiter({
  windowMs,
  max,
  now = Date.now,
}: {
  windowMs: number;
  /** 0 disables the limiter entirely. */
  max: number;
  now?: () => number;
}): Limiter {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  return {
    allow(key: string): boolean {
      if (max <= 0) return true;
      const at = now();
      const floor = at - windowMs;

      // Amortized cleanup: at most once per window, drop idle keys so a scan
      // of rotating IPs can't grow the map forever.
      if (at - lastSweep >= windowMs) {
        lastSweep = at;
        for (const [k, stamps] of hits) {
          if (!stamps.some((t) => t > floor)) hits.delete(k);
        }
      }

      const recent = (hits.get(key) ?? []).filter((t) => t > floor);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      hits.set(key, recent);
      return true;
    },
    size: () => hits.size,
  };
}
