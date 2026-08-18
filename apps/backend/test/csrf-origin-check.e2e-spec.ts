import type { Request, Response } from "express";
import { createCsrfOriginCheck } from "../src/common/csrf-origin-check";

// Not a real e2e test (no app/DB needed) — named *.e2e-spec.ts anyway since
// that's the only test glob this project's jest config picks up (see
// test/jest-e2e.json). This middleware is wired directly into main.ts's
// bootstrap(), which the full-app e2e harness (app.e2e-spec.ts et al.)
// never runs — those tests build AppModule directly and skip main.ts
// entirely, so this file is the only coverage this middleware gets. That
// gap is exactly what let a real bug through: MCP requests (Bearer-token
// auth, no browser Origin header) would have been blocked with a 403 in
// any real deployment despite every other test passing.
describe("createCsrfOriginCheck", () => {
  const ALLOWED = ["https://app.example.com"];

  function run(headers: Record<string, string | undefined>, method = "POST") {
    const middleware = createCsrfOriginCheck(ALLOWED);
    const req = { method, headers } as unknown as Request;
    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as unknown as Response;
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    return { nextCalled, statusCode, body };
  }

  it("allows safe methods regardless of Origin", () => {
    const result = run({}, "GET");
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBeUndefined();
  });

  it("allows a state-changing request with a matching Origin", () => {
    const result = run({ origin: "https://app.example.com" });
    expect(result.nextCalled).toBe(true);
  });

  it("blocks a state-changing request with no Origin/Referer and no bearer token", () => {
    const result = run({});
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("blocks a state-changing request with a non-matching Origin", () => {
    const result = run({ origin: "https://evil.example.com" });
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("allows a Bearer-authenticated request with no Origin header at all", () => {
    // This is the real-world shape of every external MCP client request
    // (Claude, ChatGPT, curl, mcp-remote) — none of them send a browser
    // Origin header, and none of them should be expected to.
    const result = run({ authorization: "Bearer zlv_abc123" });
    expect(result.nextCalled).toBe(true);
  });

  it("allows a Bearer-authenticated request even with a non-matching Origin", () => {
    const result = run({ authorization: "Bearer zlv_abc123", origin: "https://evil.example.com" });
    expect(result.nextCalled).toBe(true);
  });

  it("does not treat a malformed Authorization header as a bearer exemption", () => {
    const result = run({ authorization: "Basic dXNlcjpwYXNz" });
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(403);
  });
});
