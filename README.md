<div align="center">

<img src="assets/banner.jpg" alt="Zulivio by NodeDR" width="100%">

<br>

<img src="assets/logo.png" alt="Zulivio logo" width="120">

# Zulivio

**Open-source, self-hostable CRM and humane workforce-operations platform**

Developed by [NodeDR Infotech Private Limited](https://www.nodedr.com/)

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)
[![NestJS](https://img.shields.io/badge/backend-NestJS%2011-E0234E?logo=nestjs&logoColor=white)](apps/backend)
[![Next.js](https://img.shields.io/badge/frontend-Next.js%2015-000000?logo=next.js&logoColor=white)](apps/web)
[![Tests](https://img.shields.io/badge/e2e%20tests-26%2F26%20passing-brightgreen)](apps/backend/test/app.e2e-spec.ts)

</div>

---

Role-based employee management, work assignments, an explicit attendance
state machine, a PDF knowledge base with daily team tips, a live master
dashboard, and CSV/Google Sheets import-export. Built to run on your own
hardware — no subscription, no data leaving your server — and to be
CasaOS/ZimaOS installable.

This is the **core workforce-operations slice** of a much larger product
vision — see [ROADMAP.md](ROADMAP.md) for the full multi-department plan and
[Scope and limitations](#scope-and-limitations) below for exactly what is
and isn't built yet before you rely on this in production.

## Get Zulivio

Two ways to install, both built from the same code and pointed at the same
`http://<server>:3100` — pick whichever fits your setup.

| Platform | Status | Install | What it needs |
| --- | --- | --- | --- |
| 🐳 **Docker Compose** (any OS) | ✅ Done — the primary, most-used path | `git clone` + `./install.sh` (see [Quick start](#quick-start)) | Docker |
| 🏠 **CasaOS / ZimaOS** | ✅ Ready to install now, official app store submission pending | Install from a compose URL — see [`casaos/docker-compose.yml`](casaos/docker-compose.yml) | Nothing — CasaOS/ZimaOS pulls pre-built images, no build step |

Both pull the same multi-arch (amd64/arm64) images published by
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
and share the same database schema — nothing about your data changes if you
switch install methods later.

## Contents

- [Get Zulivio](#get-zulivio)
- [Screenshots](#screenshots)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Roles and access](#roles-and-access)
- [Core features](#core-features)
- [Google Sheets integration](#google-sheets-integration)
- [Environment variables](#environment-variables)
- [Common operations](#common-operations)
- [Local development](#local-development-without-docker)
- [Tests](#tests)
- [CasaOS / ZimaOS](#casaos--zimaos)
- [Architecture notes](#architecture-notes)
- [Scope and limitations](#scope-and-limitations)
- [Roadmap](#roadmap)
- [License](#license)

## Screenshots

All captured from a real running instance (Docker Compose, seeded with
sample data) — not mockups.

| | |
|---|---|
| **Master dashboard** — live headcount, assignment mix, who's on the clock | **Employee directory** — add/edit/reset-password/remove, all rank-guarded |
| ![Master dashboard](docs/screenshots/dashboard.png) | ![Employees](docs/screenshots/employees.png) |
| **Employee front page** — "My Work", today's tips, shift controls | **Assignments** — status pipeline with guarded transitions |
| ![Employee front page](docs/screenshots/employee-front-page.png) | ![Assignments](docs/screenshots/assignments.png) |

<details>
<summary>More screenshots (attendance, knowledge base, data hub, sign in)</summary>

| | |
|---|---|
| ![Attendance](docs/screenshots/attendance.png) | ![Knowledge base](docs/screenshots/knowledge.png) |
| ![Data Hub](docs/screenshots/data-hub.png) | ![Sign in](docs/screenshots/login.png) |

</details>

## Stack

- **Backend**: NestJS 11 + Prisma 6 + PostgreSQL 16, session-based auth
  (Argon2id password hashing), REST API under `/api/v1`.
- **Frontend**: Next.js 15 (App Router) + React 19 + TanStack Query +
  Tailwind CSS v4. Talks to the backend only through a same-origin
  server-side proxy (`/api/*` rewrites), so the session cookie stays
  first-party.
- **Monorepo**: pnpm workspaces + Turborepo, Node.js 24.
- **Shared types**: `packages/types` — TypeScript interfaces shared between
  frontend and backend API contracts.

## Quick start

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose
(bundled with current Docker Desktop/Engine).

### One-click install

```bash
git clone https://github.com/Raktim94/zulivio.git && cd zulivio && ./install.sh
```

[`install.sh`](install.sh) checks that Docker is installed, generates a
`.env` with a random Postgres password (only if one doesn't already exist —
safe to re-run), builds the images, starts the stack, waits for the backend
to report healthy, then prints the URL to open. Re-run it any time (e.g.
after `git pull`) to rebuild and restart — it never touches existing data.

### Manual install

If you'd rather run each step yourself (or `install.sh` doesn't fit your
setup), here's exactly what it does, one command at a time:

```bash
# 1. Get the code
git clone https://github.com/Raktim94/zulivio.git
cd zulivio

# 2. Set a real Postgres password — compose refuses to start without one.
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD (generate one with: openssl rand -base64 32)

# 3. Build the images (multi-stage, node:24-alpine) and start the stack.
#    The `migrate` service applies database migrations before `backend`
#    starts. First run takes a few minutes; later runs are cached and fast.
docker compose up --build -d

# 4. (optional) Watch the logs until the backend reports healthy.
docker compose logs -f

# 5. (later) Stop the stack without deleting your data:
docker compose down
```

Then open **http://localhost:3100/setup** and create your organization —
this creates your company and its first **Master Owner** account. There is
no baked-in demo password; you choose the master owner's password during
setup.

All data (the Postgres database and uploaded knowledge-base PDFs) lives in
**named Docker volumes**, not inside the containers, so it survives
`docker compose down`, container recreation, and image rebuilds. See
[Common operations](#common-operations) for backup/restore commands.

To close self-service organization creation once you're done setting up
(recommended for a single-tenant deployment), set `BOOTSTRAP_DISABLED=true`
in `.env` and restart the `backend` service.

## Roles and access

Roles form a strict hierarchy — each role can manage everything below it,
never above or beside it:

| Role | Typical use | Can do |
|---|---|---|
| **Master Owner** | Company owner | Everything, including creating Company Admins |
| **Company Admin** | Operations lead | Everything except creating other admins/owners |
| **Sales Head** | Head of sales | Manage managers/employees, assignments, reports |
| **Manager** | Team lead | Add/remove employees below them, assign work, view team reports |
| **Employee** | Front-line staff | Own attendance, own assignments, knowledge base, tips |

Enforced **server-side** on every request — a manager cannot create a peer
or higher role (privilege escalation is blocked and tested), and an
employee cannot view another employee's report. See
`apps/backend/test/app.e2e-spec.ts` for the authorization test suite.

Adding an employee generates a unique employee number (`EMP-0001`, ...) and
a random temporary password, shown **exactly once** in the UI at creation
time — it is never stored in plaintext or retrievable again. Removing an
employee marks them `SEPARATED`, immediately revokes all their sessions,
and preserves their history for reporting/audit (no hard delete, no reused
employee numbers).

The Master Owner (and anyone with a high-enough rank over the target) has
full operational control over the organization from the Employees page:

- **Edit** any subordinate's role, department, or employment status
  (including reactivating someone `SUSPENDED`/`ON_LEAVE`) — `PATCH
  /api/v1/employees/:id`. Guarded the same way as creation: you can never
  promote someone to your own rank or above.
- **Reset password** — force-generates a new temporary password for a
  subordinate and immediately revokes all their active sessions, so a
  reset takes effect right away rather than on their next natural login —
  `POST /api/v1/employees/:id/reset-password`.
- **Remove** — separates an employee and revokes their sessions —
  `DELETE /api/v1/employees/:id`.
- Full visibility into every assignment, attendance record, and report in
  the organization (Manager rank and above is unrestricted by scope;
  Employee/Manager-of-a-team see only their own or their direct reports').

All of the above are enforced server-side, tested in
`apps/backend/test/app.e2e-spec.ts` (26/26 passing), and never gated only
by hiding a button in the UI.

## Core features

- **Employees** — add/remove with auto-generated credentials, role
  assignment, manager hierarchy, department tagging.
- **Assignments** — create work, assign it to a selected employee by
  number, track through `ASSIGNED → IN_PROGRESS → FOLLOW_UP / BLOCKED →
  COMPLETED / CANCELED` with a full transition audit trail and outcome
  notes. Invalid transitions (e.g. skipping straight to `COMPLETED`) are
  rejected server-side.
- **Attendance** — explicit shift/break state machine
  (`logged_out → working → on_break → working → logged_out`), server
  timestamps, one open session per employee enforced, auto-closes a
  dangling break on shift end.
- **Employee report** — login/logout times, total worked minutes, total
  break minutes, per-session breakdown, assignment counts by outcome
  (completed/follow-up/blocked/in-progress), training acknowledged.
- **Master dashboard** — headcount, assignments by status, overdue count,
  live "who's working / on break right now" board, knowledge base stats.
- **Knowledge base & tips** — PDF upload (managers+), draft/publish
  lifecycle, role/person-targeted training assignments with per-version
  acknowledgement tracking, and a "today's tips" feed on the employee
  front page.
- **Data Hub** — CSV export (employees, assignments, leads, opportunities)
  with spreadsheet formula-injection protection; CSV import with row-level
  error reporting; a real Google Sheets adapter (see below).
- **Sales CRM** — leads with a configurable qualification pipeline
  (`NEW → CONTACTED → QUALIFIED → DISQUALIFIED`), lead-to-opportunity
  conversion that preserves history, a Kanban pipeline board (default
  6-stage pipeline: New/Qualified/Proposal/Negotiation/Won/Lost) with an
  auditable stage-transition trail, manager-only forecast-category
  overrides with a full adjustment audit, and a sales dashboard (pipeline
  value by stage, lead funnel, forecast-by-category, value/forecast-by-rep,
  and win/loss charts). CSV import/export for both leads and opportunities.
  - **Assignment rules** — three routing modes per rule: round robin,
    territory (a lead's free-text territory maps to a specific rep, falling
    back to round robin on no match), and capacity (routes to whichever
    member holds the fewest open leads, skipping anyone at their configured
    cap). Each rule carries a response SLA and feeds the overdue queue.
  - **Forecasting** — rep-level (per-owner pipeline value, weighted
    forecast, and forecast-by-category on the sales dashboard),
    manager-level (forecast-category overrides with a full audit trail via
    `forecast_adjustments`), and company-level (org-wide pipeline value and
    weighted forecast rollup) views.
- **Automated S3 backups** (Settings, Master Owner only) — a full
  instance backup (Postgres via `pg_dump --format=custom`, plus the
  uploads volume) to any S3-compatible bucket, on a rolling schedule
  (`S3_BACKUP_INTERVAL_DAYS`, default 3): back up, download-and-verify the
  upload, then delete the oldest backup past `S3_BACKUP_RETAIN_COUNT`
  (default 2) — so a verified backup always exists in the bucket, never a
  window with zero. One-click restore (`pg_restore --clean --if-exists`
  plus replacing the uploads volume) is gated behind a typed `RESTORE`
  confirmation, since it overwrites the entire database. Disabled until
  `S3_BACKUP_ENDPOINT`/`S3_BACKUP_BUCKET`/`S3_BACKUP_ACCESS_KEY_ID`/
  `S3_BACKUP_SECRET_ACCESS_KEY` are set — see Environment variables below.

## Google Sheets integration

The Google Sheets adapter is real, not a mock — but it only activates when
you provide credentials, per the "no fake integrations" rule this project
follows. To enable it:

1. Create a Google Cloud service account and enable the Sheets API.
2. Generate a JSON key and set `GOOGLE_SHEETS_CLIENT_EMAIL` /
   `GOOGLE_SHEETS_PRIVATE_KEY` in `.env` (the private key needs its
   newlines escaped as `\n` in the `.env` file).
3. Share your target spreadsheet with the service account's email address.
4. Restart the `backend` service. The Data Hub page will show "Connected"
   and expose live import/export.

Without credentials configured, `GET /api/v1/integrations/google-sheets/status`
returns `{ configured: false }` and the UI clearly says so — it never
pretends the integration works.

## Environment variables

See `.env.example` for the full list with descriptions. The important ones:

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | Shared by postgres/migrate/backend |
| `FRONTEND_ORIGIN` | No | CORS allow-origin (default `http://localhost:3100`) |
| `HOST_PORT` | No | Host port for the web app (default `3100`) |
| `BOOTSTRAP_DISABLED` | No | Set `true` to close self-service org creation |
| `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` | No | Enables live Sheets sync |
| `S3_BACKUP_ENDPOINT` / `S3_BACKUP_BUCKET` / `S3_BACKUP_ACCESS_KEY_ID` / `S3_BACKUP_SECRET_ACCESS_KEY` | No | Enables automatic backups (all four required together) |
| `S3_BACKUP_INTERVAL_DAYS` / `S3_BACKUP_RETAIN_COUNT` | No | Backup cadence (default `3`) and how many verified backups to keep (default `2`) |
| `SEED_MASTER_OWNER_PASSWORD` | Only for `pnpm db:seed` | Never baked into the image |

## Common operations

```bash
# Migrations (also run automatically by the `migrate` one-shot service on startup)
docker compose exec backend npx prisma migrate deploy

# Seed a demo organization (fails loudly if SEED_MASTER_OWNER_PASSWORD isn't set)
SEED_MASTER_OWNER_PASSWORD='...' docker compose exec -e SEED_MASTER_OWNER_PASSWORD backend npx prisma db seed

# Backup the database
docker compose exec postgres pg_dump -U nodedr zulivio | gzip > backup-$(date +%F).sql.gz

# Restore
gunzip -c backup-2026-08-12.sql.gz | docker compose exec -T postgres psql -U nodedr zulivio

# Tail logs
docker compose logs -f backend web

# Stop (data persists in named volumes)
docker compose down

# Stop AND delete all data (destructive)
docker compose down -v
```

## Local development (without Docker)

```bash
pnpm install

# Start a local Postgres however you like, then:
cd apps/backend
DATABASE_URL="postgresql://user:pass@localhost:5432/zulivio" npx prisma migrate dev
DATABASE_URL="postgresql://user:pass@localhost:5432/zulivio" pnpm dev   # backend on :4100

cd ../web
BACKEND_URL="http://localhost:4100" pnpm dev   # frontend on :3100
```

## Tests

```bash
cd apps/backend
pnpm typecheck   # tsc --noEmit
pnpm build       # nest build

# e2e/integration suite against a real Postgres (not mocked) — covers RBAC
# negative paths (privilege escalation, cross-employee report access),
# the attendance state machine, and the assignment status-transition guard
docker run --rm -d --name zulivio-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=zulivio_test -p 55432:5432 postgres:16-alpine
DATABASE_URL="postgresql://postgres:test@localhost:55432/zulivio_test" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:test@localhost:55432/zulivio_test" \
  NODE_ENV=test npx jest --config ./test/jest-e2e.json --runInBand
docker rm -f zulivio-test-pg
```

At last run: **26/26 tests passing** — bootstrap/login/logout, privilege
escalation blocked (on both create and edit), cross-employee report access
blocked, owner edit/reset-password/remove on subordinates, the full
attendance state machine (including rejecting a second concurrent
session/break), and the full assignment lifecycle (including rejecting
invalid transitions and mutations on a terminal state).

```bash
cd apps/web
pnpm typecheck
pnpm build   # production build, verified clean
```

## CasaOS / ZimaOS

`casaos/docker-compose.yml` is the CasaOS App Store manifest (`x-casaos`
metadata, bind-mounted `/DATA/AppData/$AppID/...` volumes per CasaOS
convention). Differences from the plain `compose.yaml`:

- Migrations run inline in the backend's startup command
  (`prisma migrate deploy && node dist/src/main.js`) instead of a separate
  one-shot service, since CasaOS doesn't cleanly support init containers —
  this is safe because `migrate deploy` is idempotent.
- Images are referenced by tag (`ghcr.io/raktim94/zulivio-*:1.0.0`) and
  built and published to GHCR by `.github/workflows/docker-publish.yml`
  (multi-arch amd64/arm64) rather than built locally.

`casaos/icon.png`, `casaos/thumbnail.png`, and `casaos/screenshot-{1,2,3}.png`
are all real — the icon/thumbnail come from the actual Zulivio brand
assets, and the screenshots are genuine captures from a running instance
(same source as [Screenshots](#screenshots) above), not placeholders.

**Not yet done**: official submission to the CasaOS/ZimaOS App Store
(`IceWhaleTech/CasaOS-AppStore`) — the manifest is ready and validated
locally, but hasn't been merged into the official store index yet, so
CasaOS's own "Custom Install"/compose-URL flow is the way to install it
today (see [Get Zulivio](#get-zulivio)).

## Architecture notes

- **Multi-tenancy**: every business record carries an immutable
  `organizationId`; every repository query filters by the organization
  taken from the authenticated session, never from client input.
- **Authorization**: a strict role hierarchy
  (`EMPLOYEE < MANAGER < SALES_HEAD < COMPANY_ADMIN < MASTER_OWNER`)
  enforced by a NestJS guard plus per-service checks (e.g. "an employee can
  only see their own attendance report").
- **Sessions**: random 256-bit tokens, only the SHA-256 hash stored,
  httpOnly + SameSite=lax cookies, 12h TTL, revoked on logout/password
  change/employee removal.
- **Audit trail**: `audit_events` table records who did what to what,
  when — deliberately excludes plaintext temporary passwords and password
  hashes from metadata.
- **File storage**: local disk under `UPLOADS_DIR` (a named Docker volume
  in production), not database blobs.

## Scope and limitations

This build intentionally implements the **workforce-operations core** of a
much larger specification, not the full spec. Explicitly **not** built yet:

- No contacts/accounts objects or multiple pipelines per organization —
  leads/opportunities exist on a single default pipeline per org; a
  contact/account layer and custom pipelines are not built yet.
- No product/skill-based assignment routing — round robin, territory, and
  capacity-based routing are implemented; those two are on the roadmap.
- No background job queue / Redis / worker service — CSV import and PDF
  upload run synchronously in the request. Fine at small-team scale; a
  large CSV import or PDF library will need this added.
- Live file storage is local disk under `UPLOADS_DIR`, not an
  S3-compatible object store — fine for a single-server deployment, not
  horizontally scalable as-is. (Automatic *backups* of that disk, plus
  Postgres, to an S3-compatible bucket are supported — see Core features
  above — but day-to-day serving is still local disk.)
- No automation/workflow-rule engine, no AI features.
- No MFA/SSO/OIDC — session + password only.
- No WhatsApp/telephony/email/calendar adapters.
- No row-level security (RLS) in Postgres — tenant isolation is enforced
  entirely in the application layer today.
- Assignment/employee sequence numbers are computed via `count() + 1`
  inside a transaction; the database's unique constraint prevents a
  collision from corrupting data, but under heavy concurrent writes a
  request could fail and need a retry rather than silently succeeding.
  Fine at normal team-scale write volume.

None of the above are silently faked — where a feature isn't built, there
is no button or endpoint pretending it works.

## Roadmap

What's in this repository today is the **workforce-operations foundation**
of a much larger product: a shared identity/permission/relationship core
with purpose-built departmental workspaces (Sales, Marketing, Service,
Success, Delivery, Field Service, People, Partner/Vendor) layered on top
over time, integrations-first rather than rebuilding accounting/payroll/
telephony/ad platforms in-house, and governed AI added only after the data
foundation is solid.

The full 15–18 month, phase-by-phase implementation and rollout plan —
department workspace designs, feature catalogue, migration/rollout
playbook, go/no-go checklists, and adoption safeguards — lives in
**[ROADMAP.md](ROADMAP.md)**. It's also mirrored on the
[project wiki](../../wiki) alongside architecture and getting-started pages.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<div align="center">

<br>

Built by [NodeDR Infotech Private Limited](https://www.nodedr.com/)

</div>
