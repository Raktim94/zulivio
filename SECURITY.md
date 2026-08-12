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
- Every API endpoint enforces authentication (`AuthGuard`) and role
  authorization (`RolesGuard` + per-service scope checks) server-side —
  the frontend hiding a nav item is never treated as the security boundary.
- Multi-tenant isolation: every query is scoped by the `organizationId`
  taken from the authenticated session, never from client-supplied input.
- CSV export sanitizes cells starting with `=`, `+`, `-`, or `@` to prevent
  spreadsheet formula injection when the file is opened in Excel/Sheets.
- All request bodies are validated with `class-validator` in whitelist mode
  (`forbidNonWhitelisted: true`) — unrecognized fields are rejected, not
  silently ignored.
- Login is rate-limited per email and responds in constant shape (a dummy
  hash is verified against nonexistent accounts) to reduce account
  enumeration.
- Audit events deliberately exclude plaintext secrets and password hashes
  from their metadata.

## What this project does not (yet) claim

- No independent security audit or penetration test has been performed.
- No compliance certification (SOC 2, ISO 27001, etc.) is claimed.
- No MFA/SSO — a compromised password is a compromised account until MFA
  is added.
- Rate limiting is in-memory per backend instance — sufficient for a
  single-instance deployment, not for a horizontally-scaled one (would
  need to move to Redis).
- No Postgres row-level security — tenant isolation depends entirely on
  correct application-layer scoping being maintained as the codebase grows.

If you find a gap between this document and the actual code, please report
it — this file describes intent, not a guarantee.
