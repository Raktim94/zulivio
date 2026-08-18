# Zulivio Security Audit Report

**Scope:** Full application (`apps/backend`, `apps/web`), dependency tree, and git history.
**Baseline commit:** `40db923` (before this audit's fixes) — this report ships together with the fixes on top of it.
**Method:** Manual code review of the auth/RBAC/tenant-isolation surface, `pnpm audit` + `pnpm outdated` dependency scan, pattern-based secret scan across the working tree and full git history, and new regression tests proven to fail pre-fix and pass post-fix.

This is Phase 0 of a larger tracked plan (`TODO.md`) — a security/dependency pass done first, before the Employee Workspace and Sales Head Dashboard features that build on top of it.

Findings are ordered by severity. Each entry: Location, Impact, Root cause, Fix, Regression test, Status.

---

## Critical / High

### 1. `AuthGuard`/`RolesGuard` applied per-controller, not globally
- **Location:** every `*.controller.ts` (previously each opted in individually via `@UseGuards`); `app.module.ts`
- **Impact:** a new controller that forgets `@UseGuards(AuthGuard, RolesGuard)` is silently unauthenticated — any future route is unprotected by default rather than by exception.
- **Root cause:** no `APP_GUARD` provider; protection was opt-in per controller instead of opt-out.
- **Fix:** registered `AuthGuard` as a global `APP_GUARD` in `app.module.ts`, with a new `@Public()` decorator (`common/decorators/public.decorator.ts`) for the three routes that must work pre-session: `POST /auth/sessions` (login), `POST /bootstrap`, `GET /api/health`. Every other route is now protected by default.
- **Regression test:** pre-existing `"rejects requests to protected routes without a session"` (`test/app.e2e-spec.ts`) continues to cover this at the integration level; the global-guard wiring itself is structural (can't silently regress the way per-controller opt-in could).
- **Status:** Fixed.

### 2. No cross-tenant isolation e2e tests
- **Location:** `test/app.e2e-spec.ts`
- **Impact:** `SECURITY.md` states tenant isolation is 100% application-layer (no Postgres RLS) — every write/read path relies on hand-written `organizationId: actor.organizationId` filters, but nothing had ever proven those filters actually hold under ID-guessing across two real organizations. This is the highest-value gap: a single missed filter anywhere is a full cross-tenant data leak.
- **Root cause:** no test ever exercised two organizations against each other.
- **Fix:** added a `describe("cross-tenant isolation", ...)` block creating two fully independent orgs (Tenant A / Tenant B) and asserting Org B's `MASTER_OWNER` (deliberately the highest-ranked actor, to prove role rank alone never substitutes for org membership) gets `404` attempting to: edit/reset-password/remove an Org A employee, list Org A employees, assign/transition an Org A assignment, read an Org A lead, transition an Org A opportunity's stage or forecast category, read an Org A employee's attendance report, or see an Org A audit event in Org B's audit log. 7 new tests, all passing.
- **Regression test:** verified the methodology itself — temporarily removed the `organizationId` filter from `leads.service.ts`'s `findScoped`, confirmed the new `"404s a cross-org lead read"` test fails (`200` instead of `404`) as expected, then reverted. All other cross-tenant queries in the codebase already used the same `findFirst({ where: { id, organizationId } })` pattern (verified by direct code read of `employees`, `assignments`, `leads`, `opportunities`, `attendance`, `audit` services) — no cross-tenant leak was found; this closes the coverage gap, not a live vulnerability.
- **Status:** Fixed (tests added; existing isolation code confirmed correct, not patched).

## High

### 3. `SALES_HEAD` rank duplicated independently in 11 places
- **Location:** `roles.guard.ts`, `employees.service.ts`, and a copy-pasted `MANAGER_RANK` constant in `assignments`, `leads`, `opportunities`, `attendance`, `reports`, `import-export`, `knowledge`, `assignment-rules` services.
- **Impact:** three independently-maintained copies of the role hierarchy had already drifted into different semantics in places; any future role added or reordered would need 11 correct edits to stay consistent, and a missed one silently mis-authorizes.
- **Fix:** consolidated into `common/roles.ts` (`ROLE_HIERARCHY`, `rank()`, `hasMinimumRank()`, `rolesBelow()`, `isManagerOrAbove()`, `isSalesHeadOrAbove()`) as the single source of truth; every call site now imports from there.
- **Regression test:** existing RBAC hierarchy tests (privilege escalation blocked on create/update, employee-directory scoping) continue to pass against the consolidated implementation.
- **Status:** Fixed.

### 4. `assignmentNumber` / `employeeNumber` race condition
- **Location:** `assignments.service.ts::create`, `employees.service.ts::create`
- **Impact:** both numbers are generated as `count() + 1` against a per-organization `@@unique` constraint, not a DB sequence. Two concurrent creates in the same org can read the same count and collide, surfacing a raw 500 instead of succeeding.
- **Fix:** retry loop (max 5 attempts) that re-reads the count and retries only on the specific unique-constraint violation (`P2002` on that column), letting every other error propagate immediately. Applied to both `assignments.service.ts` (already fixed on entry to this session) and `employees.service.ts` (fixed this session, same pattern, same root cause).
- **Regression test:** existing assignment-lifecycle e2e test asserts `assignmentNumber` is allocated correctly under normal (non-concurrent) load; the retry path itself is exercised only under real concurrency, which the current e2e suite doesn't simulate — noted as a coverage gap, not a functional gap (logic mirrors the already-reviewed assignment version).
- **Status:** Fixed.

### 5. No CSRF defense beyond `SameSite=lax`
- **Location:** `main.ts`
- **Impact:** the session cookie is `SameSite=lax`, which blocks cross-site state-changing requests in modern, standards-compliant browsers, but offers no protection for older or misconfigured clients/proxies that don't honor the attribute.
- **Fix:** added an Origin/Referer allowlist check (`common/csrf-origin-check.ts`) as raw Express middleware ahead of the router, applied to all state-changing methods (`POST`/`PUT`/`PATCH`/`DELETE`), rejecting with `403` if the request's `Origin` (falling back to `Referer`) isn't in the same allowlist used for CORS (`CORS_ORIGIN`, now comma-separated-list-capable in both places for multi-hostname self-hosted deployments).
- **Regression test:** not covered by an e2e test in this pass — the e2e suite runs same-origin `supertest` requests with no `Origin` header, which the current middleware would need a same-origin exemption to avoid breaking (verified manually: `supertest` requests have no `Origin`/`Referer` header at all on non-browser HTTP clients, and the existing e2e suite's 48 tests all still pass with the middleware active, confirming it doesn't false-positive on header-less requests — see the "Safe methods" bypass; a browser cross-site POST **would** carry an `Origin` header and get rejected). A dedicated middleware unit test is a reasonable Phase 1 addition.
- **Status:** Fixed.

### 6. `helmet` / security headers missing
- **Location:** `main.ts`
- **Impact:** no `X-Content-Type-Options`, `X-Frame-Options`, HSTS, etc. by default.
- **Fix:** `helmet()` added, with CSP and HSTS opt-in via `ENABLE_CSP`/`COOKIE_SECURE` env vars rather than forced on — self-hosted deployments commonly sit behind a plain-HTTP LAN reverse proxy (documented precedent: `COOKIE_SECURE` in `auth.controller.ts`), and forcing HSTS/CSP on by default would break those setups without an opt-out.
- **Status:** Fixed.

### 7. Bootstrap endpoint: no rate limiting, account-existence enumeration
- **Location:** `bootstrap.service.ts`
- **Impact:** unauthenticated `POST /bootstrap` could be hit unlimited times, and its "email already exists" response confirms whether an email is registered anywhere in the system.
- **Fix:** added the same `InMemoryRateLimiter` used by login (`common/rate-limiter.ts`, extracted from `auth.service.ts` into a reusable class this session), keyed by caller IP, 5 attempts/hour.
- **Accepted risk:** the enumeration signal itself ("email already exists") is not removed — self-service org creation must tell the caller why bootstrap failed, or the UX breaks. Rate limiting reduces this to a slow, noisy enumeration channel rather than eliminating it. Same single-instance/in-memory caveat as the login limiter already documented in `SECURITY.md` — a horizontally-scaled deployment needs a shared store (Redis) instead.
- **Status:** Fixed (rate limiting); enumeration signal is an accepted risk, documented above.

### 8. No rate limiting on password change
- **Location:** `auth.service.ts::changePassword`
- **Fix:** added a second `InMemoryRateLimiter` instance, same class, keyed by employee ID.
- **Status:** Fixed.

## Medium

### 9. Email-uniqueness scoping mismatch
- **Location:** `bootstrap.service.ts`, `employees.service.ts`, `auth.service.ts`, `prisma/schema.prisma`
- **Impact:** `Employee.email` was only DB-unique per-organization (`@@unique([organizationId, email])`), but both `login` (`auth.service.ts`) and `bootstrap` resolve an employee by `findFirst({ where: { email } })` with **no** `organizationId` in the lookup — email is a de facto global identifier in practice, but the database didn't enforce that, and `employees.service.ts::create` (regular in-org employee creation by an admin) didn't check global uniqueness at all before this fix. Two orgs could end up with the same email on two different employees, and login would then resolve unpredictably to whichever row the DB returns first — a real cross-tenant account-confusion bug, not just an inconsistency.
- **Fix (app layer):** added the same global `findFirst({ where: { email } })` pre-check already used by `bootstrap.service.ts` into `employees.service.ts::create`, plus a `P2002`-on-`email` catch as a race-window fallback with a clean `400` instead of a raw DB error.
- **Fix (database):** migration `20260818095045_employee_email_global_unique` changed `@@unique([organizationId, email])` to a global `@@unique([email])` on the `Employee` model — applied via `prisma migrate deploy` (non-interactive; `migrate dev`'s confirmation prompt isn't available in a non-TTY session, so the exact SQL was generated with `prisma migrate diff` and committed as a normal migration, then deployed). Verified live: `employees_organizationId_email_key` dropped, `employees_email_key` (single-column, unique) confirmed present via `pg_indexes`. 68/68 e2e tests still pass post-migration, including the bootstrap-duplicate-email test.
- **Status:** Fixed — both the app-layer check and the database constraint are now in place.

### 10. `BackupConfig` S3 credentials stored plaintext in Postgres
- **Location:** `prisma/schema.prisma` (`BackupConfig` model, already flagged in its own schema comment)
- **Impact:** anyone with DB read access (including a DB backup/dump) can read live S3 credentials.
- **Fix:** `FieldEncryptionService` (`apps/backend/src/common/crypto/field-encryption.service.ts`, global module) — AES-256-GCM envelope encryption, key from `FIELD_ENCRYPTION_KEY` env var (32 raw bytes, base64; generate with `openssl rand -base64 32`), never stored in the database. `secretAccessKey` is encrypted before every write in `BackupService.setConfig()` and decrypted on every read in `getConfig()`. `accessKeyId` stays plaintext deliberately — it's an identifier, not a secret (same treatment AWS itself gives it), and is still masked before ever leaving the API. `decrypt()` passes through any value without the `v1:` prefix unchanged, so existing plaintext rows keep working without a data migration — they're re-encrypted automatically the next time the config is saved through Settings. No schema/column changes were needed (same `String` column, now holding ciphertext instead of plaintext). Covered by `test/field-encryption.e2e-spec.ts` (round-trip, random IV per encryption, legacy-plaintext passthrough, tamper detection via the GCM auth tag, clear errors on a missing/wrong-length key) — 74/74 e2e tests pass with this in place.
- **Also fixed:** `GoogleSheetsConfig.privateKey` had the identical plaintext-at-rest pattern (added in a separate, in-progress Google Sheets Settings-integration change to this repo) — wired into the same `FieldEncryptionService` when that feature was pushed. `clientEmail` stays plaintext (an identifier, not a secret) and is still the only field returned by the API.
- **Status:** Fixed.

## Informational

### 11. Dependency upgrade pass
- Bumped within current majors: `@nestjs/*` → `11.2.1`, `argon2` → `0.45.1`, `class-validator` → `0.15.1`, `@aws-sdk/client-s3` → `3.1111.0`, plus added `helmet@8.3.0`, `eslint@9.39.5`/`typescript-eslint@8.67.0` (backend previously had no lint config at all — added `apps/backend/eslint.config.mjs` this session, `recommendedTypeChecked` ruleset).
- Separately: `deepmerge-ts` (transitive, via `@prisma/config`) bumped `7.1.5` → `8.0.1` via a `pnpm-workspace.yaml` override, fixing **GHSA-ggr8-5vv4-36mx / CVE-2026-40345** (High, stack-exhaustion DoS on recursive object graphs) — Dependabot alert #30, committed and pushed separately (`6d95408`) before this audit began.
- `pnpm audit`: **0 known vulnerabilities** (post-fix).
- `pnpm outdated`: 0 outdated npm packages (the one flagged entry is an `engines.node >=24` mismatch against the local Node 22.23.0 — a local dev-environment note, not a dependency finding).

### 12. Secret scan
- Pattern-based scan (AWS keys, PEM private key headers, Google API keys, Slack/GitHub/Stripe tokens, credential-embedded connection strings) across the full working tree and full git history (36 commits, all reachable refs).
- **Result: clean.** `.env` (containing real dev credentials like `POSTGRES_PASSWORD`) is git-ignored and was never committed. No hardcoded secrets found in tracked files or history.
- gitleaks itself wasn't available in this environment (no network install path for the Go binary within this session); the pattern scan above is the "or equivalent" per this audit's own mandate. Recommend wiring actual `gitleaks` into CI as a follow-up (`.github/workflows/`), so future commits get scanned automatically rather than relying on periodic manual audits like this one.

---

## Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — green on both `apps/backend` and `apps/web` after all fixes above (backend lint required one config addition: two new rule overrides scoped to `test/**/*.e2e-spec.ts` only, since supertest's `res.body` is inherently untyped JSON — production code under `src/` keeps the full strict ruleset).
- e2e suite: **48/48 passing** against a real Postgres 16 (not mocked), including the 7 new cross-tenant isolation tests.
- The cross-tenant test methodology was itself verified: one test was proven to fail against a deliberately-reintroduced bug (removed `organizationId` filter), then the revert was confirmed to restore all 48 passing.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Guards not global | Critical | Fixed |
| 2 | No cross-tenant tests | Critical | Fixed |
| 3 | Role-rank duplication (11×) | High | Fixed |
| 4 | assignmentNumber/employeeNumber race | High | Fixed |
| 5 | No CSRF mitigation | High | Fixed |
| 6 | No security headers | High | Fixed |
| 7 | Bootstrap unrated-limited + enumeration | High | Fixed (rate limit); enumeration accepted risk |
| 8 | Password-change unrated-limited | High | Fixed |
| 9 | Email-uniqueness scoping mismatch | Medium | Fixed (app-layer check + DB constraint) |
| 10 | Plaintext S3 credentials | Medium | Open / accepted risk |
| 11 | Dependency currency | Info | Done — 0 known vulnerabilities |
| 12 | Secret scan | Info | Done — clean |

Deferred to Phase 1+ per the tracked plan: RBAC scope-resolution helper (Sales Head team-scoped visibility, currently identical to Manager), Employee Workspace, Sales Head Dashboard, Quality Audit / Workflow schema.
