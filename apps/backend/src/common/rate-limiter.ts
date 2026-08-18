import { HttpException, HttpStatus } from "@nestjs/common";

interface AttemptRecord {
  count: number;
  windowStart: number;
}

/**
 * In-memory, best-effort rate limiter keyed by an arbitrary string (email,
 * IP, etc). Adequate for a single-instance deployment; a distributed
 * deployment should move this to a shared store (e.g. Redis) — see
 * SECURITY.md and SECURITY_AUDIT_REPORT.md.
 */
export class InMemoryRateLimiter {
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly message = "Too many attempts. Try again later.",
  ) {}

  assert(key: string): void {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || now - record.windowStart > this.windowMs) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return;
    }
    if (record.count >= this.maxAttempts) {
      throw new HttpException(this.message, HttpStatus.TOO_MANY_REQUESTS);
    }
    record.count += 1;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
