# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub
(`Security` tab → `Report a vulnerability`) rather than a public issue.
Include reproduction steps and affected version/commit. We aim to
acknowledge within a few days.

## What this project does

- Passwords are hashed with Argon2id; nothing is ever stored in plaintext,
  and temporary passwords generated on employee creation are returned to
  the caller exactly once and never persisted or logged.
- Sessions are random 256-bit tokens; only their SHA-256 hash is stored.
  Cookies are httpOnly, SameSite=lax, and `secure` in production.
- Authentication (`AuthGuard`) is enforced globally via `APP_GUARD` — every
  route requires a valid session by default, opting out only with an
  explicit `@Public()` decorator (login, bootstrap, health). A new
  controller that forgets to guard itself is protected anyway, rather than
  silently open.
- Role authorization (`RolesGuard` + per-service scope checks) is enforced
  server-side — the frontend hiding a nav item is never treated as the
  security boundary.
- Multi-tenant isolation: every query is scoped by the `organizationId`
  taken from the authenticated session, never from client-supplied input.
  Proven by a dedicated cross-tenant e2e test suite (two independent
  organizations, ID-guessing across the boundary asserted to `404` on every
  employee/assignment/lead/opportunity/attendance/audit-log route).
- `helmet` security headers on every response; CSP/HSTS are opt-in via
  `ENABLE_CSP`/`COOKIE_SECURE` for self-hosted LAN deployments behind
  plain-HTTP reverse proxies.
- CSRF defense in depth: the session cookie is `SameSite=lax` (blocks
  cross-site state-changing requests in modern browsers), backed by an
  Origin/Referer allowlist check on every state-changing request as a
  second layer for older/misconfigured clients.
- CSV export sanitizes cells starting with `=`, `+`, `-`, or `@` to prevent
  spreadsheet formula injection when the file is opened in Excel/Sheets.
- All request bodies are validated with `class-validator` in whitelist mode
  (`forbidNonWhitelisted: true`) — unrecognized fields are rejected, not
  silently ignored.
- Login, password-change, and self-service org bootstrap are all
  rate-limited, and login responds in constant shape (a dummy hash is
  verified against nonexistent accounts) to reduce account enumeration.
- Audit events deliberately exclude plaintext secrets and password hashes
  from their metadata.
- `pnpm audit` reports 0 known vulnerabilities as of the last dependency
  pass; a pattern-based secret scan of the full working tree and git
  history found no committed credentials.

## What this project does not (yet) claim

- No independent (third-party) security audit or penetration test has been
  performed — an internal audit was done and its findings/fixes are
  published in full at [`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md),
  including what's still open.
- No compliance certification (SOC 2, ISO 27001, etc.) is claimed.
- No MFA/SSO — a compromised password is a compromised account until MFA
  is added.
- Rate limiting is in-memory per backend instance — sufficient for a
  single-instance deployment, not for a horizontally-scaled one (would
  need to move to Redis).
- No Postgres row-level security — tenant isolation depends entirely on
  correct application-layer scoping being maintained as the codebase grows
  (see the cross-tenant test suite above for how that's verified today).
- `BackupConfig` S3 credentials are stored plaintext in Postgres — a known,
  open finding (see the audit report). Anyone with DB read access can read
  live backup-destination credentials.
- `Employee.email` uniqueness is enforced per-organization at the database
  level, but treated as a global identifier by login — an app-layer check
  narrows the gap, but the full fix needs a schema migration and is not
  yet applied (see the audit report, finding #9).

If you find a gap between this document and the actual code, please report
it — this file describes intent, not a guarantee.
