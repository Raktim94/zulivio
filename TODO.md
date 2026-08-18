# Zulivio Agent Workspace / Sales Head / Security Audit — Implementation TODO

Tracking doc for the work specified in `ZULIVIO_AGENT_WORKSPACE_SALES_HEAD_SECURITY_SPEC` (see chat/plan history).
Full plan: `~/.claude/plans/gleaming-watching-koala.md`. Update checkboxes as work lands; keep commits small and incremental on `main`.

## Phase 0 — Security audit & dependency upgrade
- [x] Record baseline commit SHA + run `pnpm install --frozen-lockfile`, `pnpm audit`, `pnpm outdated`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- [x] Upgrade dependencies to latest stable (Nest/Prisma/Next/React/TanStack Query/Tailwind/argon2/class-validator/etc.), re-verify `pnpm-workspace.yaml` overrides
- [x] Secret scan (gitleaks or equivalent) across repo + git history — clean; gitleaks unavailable in-session, pattern-scan used instead (see report)
- [x] Write `SECURITY_AUDIT_REPORT.md` with findings by severity
- [x] Fix: global `AuthGuard` via `APP_GUARD` + `@Public()` opt-out
- [x] Fix: consolidate role-hierarchy arrays into `apps/backend/src/common/roles.ts`
- [x] Fix: `assignmentNumber` race condition (also fixed the identical `employeeNumber` race, same root cause)
- [x] Fix: rate limit bootstrap + password-change
- [x] Fix: helmet + CSRF mitigation in `main.ts`
- [x] Add: cross-tenant isolation e2e tests (7 tests, verified to fail pre-fix)
- [ ] Open: `Employee.email` global-uniqueness migration (`@@unique([email])`) — app-layer check landed, DB-level fix needs a migration; deferred pending explicit confirmation before Phase 2
- [ ] Open: `BackupConfig` S3 credentials plaintext-in-DB — accepted risk, not addressed this pass (see report)

## Phase 1 — Backend RBAC rework
- [x] `common/roles.ts` single source of truth (landed in Phase 0)
- [x] Scope-resolution helper (`common/scope.service.ts` + `common/scope.module.ts`) — Employee (self)/Manager (direct reports)/Sales Head (full subtree)/Admin+Owner (full org)
- [x] Thread scope helper through `reports.service.ts` (`salesDashboard` owner-filtering, `employeeTotalReport` access check) and `assignments.service.ts` (`assign` target validation). `employees.service.ts`'s directory listing deliberately stays rank-based, not subtree-based — see the doc comment on `EmployeeScopeService` for why (it's a different, HR-style visibility concern from CRM/reporting scope).
- [x] Authorization regression tests (6 new: Manager→direct-report allowed, Manager→other-manager's-report blocked despite same rank-gate, Sales-Head→subtree-grandchild allowed, employee-report access scoped the same way, sales-dashboard owner-filtering verified per role) — verified to fail pre-fix, pass post-fix

## Phase 2 — Employee workspace
- [x] Backend `apps/backend/src/me/` module: `/me/home`, `/me/tasks`, `/me/quality-audits`, `/me/reports`
- [x] New schema: Quality Audit (definition + result models) — migration `20260818084246_quality_audit_and_workflow`
- [x] New schema: Workflow/Helpdesk (definition + run models) — same migration
- [x] Author-side APIs: `apps/backend/src/quality-audits/` (Manager+ create/publish results) and `apps/backend/src/workflows/` (Manager+ author/publish, employee runs) — not explicitly named in the original plan text but required for the schema above to be reachable/testable end to end
- [x] Agent Assist endpoint (knowledge/CRM-driven, no AI) + audit logging (`agent_assist.lookup` AuditEvent, no PII beyond hasMatch)
- [x] 20 new e2e tests (quality audits, workflows, /me endpoints) — 64/64 passing, one scope check verified to fail pre-fix
- [ ] Frontend UI primitives: Dialog, Tabs, Toast, Table (paginated/sortable), Skeleton, mobile nav drawer, shared `StatCard`
- [ ] Frontend: Home (extend existing "My Work"), Start Work, Tasks (Forms & Tasks), Quality, Agent Assist, Helpdesk, Settings (Profile/Team/Password tabs)
- [ ] Sidebar regrouping (My Work / Quality / Agent Tools / Account)

## Phase 3 — Sales Head workspace
- [ ] Extend `salesDashboard()` with scope filtering, drill-down record IDs, trend data
- [ ] `apps/backend/src/sales-head/` module: employee directory, employee detail tabs, assign/reassign task
- [ ] Frontend: Sales Head dashboard (graphs + drill-down), employee directory, employee detail (7 tabs), Assign Task dialog

## Phase 4 — Docs & report
- [ ] README.md: tech stack section + security section
- [ ] SECURITY.md updates reflecting Phase 0 fixes
- [ ] ROADMAP.md: mark delivered stages, note Agent Assist is non-AI by design
- [ ] Publish `SECURITY_AUDIT_REPORT.md` as a hosted Artifact report

## Verification
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green at each phase boundary
- [ ] New authorization/tenant tests proven to fail pre-fix, pass post-fix
- [ ] Playwright pass across employee + Sales Head flows at 375/768/1440px, accessibility check
- [ ] Final summary: changed files, migrations, env vars, test evidence, findings fixed/open, report URL
