import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * Origin/Referer allowlist check for state-changing requests. The session
 * cookie is already SameSite=lax (see auth.controller.ts), which blocks
 * cross-site POST/PUT/PATCH/DELETE in modern browsers — this is defense in
 * depth for older/misconfigured clients and proxies that might not forward
 * cookie attributes intact, per SECURITY_AUDIT_REPORT.md.
 *
 * Runs as raw Express middleware (registered before Nest's router), so on
 * rejection it writes the same JSON error shape as AllExceptionsFilter
 * directly, rather than throwing a NestJS HttpException that filter can't
 * intercept at this stage of the pipeline.
 *
 * Exempts `Authorization: Bearer` requests (API keys, see mcp/ and
 * api-keys/): CSRF is only a risk when auth rides along automatically with
 * the browser (cookies) — a bearer token is never attached by a browser to
 * a cross-site request on its own, so there's nothing for this check to
 * defend against there, and enforcing it would make the MCP server
 * unreachable for every real external client (Claude, ChatGPT, curl, none
 * of which send an Origin header matching this app's own front-end).
 */
export function createCsrfOriginCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || req.headers.authorization?.startsWith("Bearer ")) {
      next();
      return;
    }

    const origin = req.headers.origin ?? originFromReferer(req.headers.referer);

    if (!origin || !allowed.has(origin)) {
      res.status(403).json({
        error: {
          code: "ForbiddenException",
          message: "Cross-origin request blocked",
          correlationId: (req.headers["x-correlation-id"] as string) ?? randomUUID(),
        },
      });
      return;
    }

    next();
  };
}
