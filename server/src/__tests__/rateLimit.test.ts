import { describe, expect, it } from "vitest";
import { createLimiter } from "../rateLimit";

describe("createLimiter", () => {
  it("allows up to `max` calls per window, then refuses", () => {
    const now = 0;
    const limiter = createLimiter({ windowMs: 60_000, max: 3, now: () => now });
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const now = 0;
    const limiter = createLimiter({ windowMs: 60_000, max: 1, now: () => now });
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-2")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(false);
  });

  it("slides: old calls expire out of the window", () => {
    let now = 0;
    const limiter = createLimiter({ windowMs: 60_000, max: 2, now: () => now });
    expect(limiter.allow("ip-1")).toBe(true);
    now = 30_000;
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(false);
    now = 61_000; // first call expired
    expect(limiter.allow("ip-1")).toBe(true);
    expect(limiter.allow("ip-1")).toBe(false);
  });

  it("max 0 disables the limiter — everything passes", () => {
    const limiter = createLimiter({ windowMs: 60_000, max: 0, now: () => 0 });
    for (let i = 0; i < 50; i += 1) expect(limiter.allow("ip-1")).toBe(true);
  });

  it("forgets idle keys so the map cannot grow unbounded", () => {
    let now = 0;
    const limiter = createLimiter({ windowMs: 1_000, max: 1, now: () => now });
    for (let i = 0; i < 100; i += 1) limiter.allow(`ip-${i}`);
    now = 10_000;
    limiter.allow("fresh"); // any call past the window sweeps expired keys
    expect(limiter.size()).toBeLessThanOrEqual(1);
  });
});
