/**
 * Least-privilege allowlist for signed-in Android app credentials (zla_ access
 * tokens). A mobile token resolves to its employee, so every existing role /
 * ownership check still applies; this list additionally stops a stolen phone
 * token from reaching administration (API keys, backups, employee management,
 * integrations, lead bulk-delete, scoring config, ...) even when the employee
 * is a Master Owner. Anything not listed is denied.
 *
 * Matching is on method + path with no query string. Paths use `:id` style
 * segments matched as a single non-slash segment.
 */
type Rule = readonly [method: string, pattern: RegExp];

// `:id` must never match a reserved literal segment: Nest routes PATCH
// /leads/score-config to the scoring-config handler, so a loose `:id` would
// silently let a phone reach it through the PATCH /leads/:id rule.
const seg = "(?!(?:bulk|search|next|my-day|score-config)(?:/|$))[^/]+";
const rule = (method: string, path: string): Rule => [method, new RegExp(`^${path.replace(/:id/g, seg)}/?$`)];

const RULES: Rule[] = [
  // Identity / my work
  rule("GET", "/api/v1/employees/me"),
  rule("GET", "/api/v1/me/home"),
  rule("GET", "/api/v1/me/tasks"),
  rule("POST", "/api/v1/auth/change-password"),
  rule("GET", "/api/v1/pipelines"),
  rule("GET", "/api/v1/tips/feed"),
  // Leads (no bulk actions, no scoring config, no delete)
  rule("GET", "/api/v1/leads"),
  rule("POST", "/api/v1/leads"),
  rule("GET", "/api/v1/leads/search"),
  rule("GET", "/api/v1/leads/next"),
  rule("GET", "/api/v1/leads/my-day"),
  rule("GET", "/api/v1/leads/:id"),
  rule("GET", "/api/v1/leads/:id/detail"),
  rule("GET", "/api/v1/leads/:id/activities"),
  rule("GET", "/api/v1/leads/:id/follow-ups"),
  rule("PATCH", "/api/v1/leads/:id"),
  rule("PATCH", "/api/v1/leads/:id/stage"),
  rule("PATCH", "/api/v1/leads/:id/qualification"),
  rule("POST", "/api/v1/leads/:id/calls"),
  rule("POST", "/api/v1/leads/:id/calls/disposition"),
  rule("POST", "/api/v1/leads/:id/call-initiated"),
  rule("POST", "/api/v1/leads/:id/notes"),
  rule("POST", "/api/v1/leads/:id/follow-ups"),
  // Follow-ups
  rule("GET", "/api/v1/follow-ups"),
  rule("PATCH", "/api/v1/follow-ups/:id/complete"),
  rule("PATCH", "/api/v1/follow-ups/:id/reschedule"),
  rule("POST", "/api/v1/follow-ups/:id/cancel"),
  // Attendance
  rule("GET", "/api/v1/work-sessions/me"),
  rule("POST", "/api/v1/work-sessions/start"),
  rule("POST", "/api/v1/work-sessions/:id/breaks/start"),
  rule("POST", "/api/v1/work-sessions/:id/breaks/:id/end"),
  rule("POST", "/api/v1/work-sessions/:id/end"),
  // Tasks
  rule("GET", "/api/v1/assignments"),
  rule("POST", "/api/v1/assignments/:id/transitions"),
];

export function isMobileRouteAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return RULES.some(([rm, re]) => rm === m && re.test(path));
}
