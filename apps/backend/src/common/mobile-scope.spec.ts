import { isMobileRouteAllowed } from "./mobile-scope";

describe("isMobileRouteAllowed", () => {
  it.each([
    ["GET", "/api/v1/leads/my-day"],
    ["GET", "/api/v1/leads/4d2fe9c9-1530-441c-be1b-81b489d5572e/detail"],
    ["POST", "/api/v1/leads/abc/calls/disposition"],
    ["POST", "/api/v1/leads/abc/call-initiated"],
    ["PATCH", "/api/v1/follow-ups/abc/complete"],
    ["POST", "/api/v1/work-sessions/s1/breaks/b1/end"],
    ["GET", "/api/v1/leads/search/"],
  ])("allows %s %s", (m, p) => expect(isMobileRouteAllowed(m, p)).toBe(true));

  it.each([
    ["DELETE", "/api/v1/leads/abc"],
    ["POST", "/api/v1/leads/bulk/delete-all"],
    ["POST", "/api/v1/leads/bulk/assign"],
    ["PATCH", "/api/v1/leads/score-config"],
    ["GET", "/api/v1/api-keys"],
    ["POST", "/api/v1/api-keys"],
    ["GET", "/api/v1/employees"],
    ["POST", "/api/v1/employees"],
    ["GET", "/api/v1/backups/download"],
    ["POST", "/api/v1/mcp"],
    ["GET", "/api/v1/mobile/devices"],
    ["GET", "/api/v1/audit-events"],
    ["POST", "/api/v1/system/update/apply"],
    ["GET", "/api/v1/leads/abc/extra/segments"],
    ["GET", "/api/v1/leads/../employees"],
  ])("denies %s %s", (m, p) => expect(isMobileRouteAllowed(m, p)).toBe(false));
});
