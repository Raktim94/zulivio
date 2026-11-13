import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { Observable, catchError, from, of, switchMap, tap, throwError } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const RETENTION_MS = 48 * 60 * 60 * 1000;

/** Who the key belongs to: keys are namespaced so two clients can never replay each other's responses. */
function scopeOf(req: Request): string | null {
  if (req.mobileAuth) return `mobile:${req.mobileAuth.deviceId}`;
  if (req.mobileDevice) return `mobile:${req.mobileDevice.id}`;
  if (req.integrationCredential) return `ext:${req.integrationCredential.id}`;
  return null;
}

/**
 * Makes retried writes safe. Applies only to authenticated mobile / integration
 * callers that send an `Idempotency-Key` header; browser-session traffic is
 * untouched.
 *
 *  - first use of a key: the handler runs; a 2xx response body is stored
 *  - same key + same request again: the stored body is replayed with
 *    `Idempotent-Replayed: true` and the handler does NOT run
 *  - same key + different request: 422 IDEMPOTENCY_KEY_REUSED
 *  - same key while the first is still running: 409 IDEMPOTENCY_IN_PROGRESS
 *  - handler failed: the key is released so the client can retry
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const rawKey = req.header("idempotency-key");
    if (!rawKey || !WRITE_METHODS.has(req.method)) return next.handle();
    const scope = scopeOf(req);
    if (!scope) return next.handle();

    if (!KEY_PATTERN.test(rawKey)) {
      throw new HttpException({ code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key must be 8-128 characters of letters, digits, _ . : -" }, 400);
    }
    const requestHash = createHash("sha256")
      .update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`)
      .digest("hex");

    return from(this.claim(scope, rawKey, requestHash, req)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.setHeader("Idempotent-Replayed", "true");
          return of(existing);
        }
        return next.handle().pipe(
          tap((body) => {
            void this.prisma.idempotencyRecord
              .update({
                where: { scopeKey_key: { scopeKey: scope, key: rawKey } },
                data: { statusCode: res.statusCode || 200, responseBody: (body ?? null) as never },
              })
              .catch((e: unknown) => this.logger.warn(`Could not store idempotent response: ${(e as Error).name}`));
          }),
          catchError((err: unknown) =>
            from(this.prisma.idempotencyRecord.deleteMany({ where: { scopeKey: scope, key: rawKey, statusCode: 0 } }).catch(() => undefined)).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  /** Returns the stored body to replay, or null when this request should run (having reserved the key). */
  private async claim(scopeKey: string, key: string, requestHash: string, req: Request): Promise<unknown> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { scopeKey, key, requestHash, method: req.method, path: req.path.slice(0, 200) },
      });
      return null;
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
    const row = await this.prisma.idempotencyRecord.findUnique({ where: { scopeKey_key: { scopeKey, key } } });
    if (!row) return this.claim(scopeKey, key, requestHash, req); // purged between the two calls
    if (row.requestHash !== requestHash) {
      throw new UnprocessableEntityException({ code: "IDEMPOTENCY_KEY_REUSED", message: "This Idempotency-Key was already used with a different request." });
    }
    if (row.statusCode === 0) {
      throw new ConflictException({ code: "IDEMPOTENCY_IN_PROGRESS", message: "A request with this Idempotency-Key is still being processed. Retry shortly." });
    }
    return row.responseBody ?? {};
  }

  @Cron("15 4 * * *")
  async purge() {
    try {
      await this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } });
    } catch (e) {
      this.logger.error(`Idempotency purge failed: ${(e as Error).name}`);
    }
  }
}
