# Windows Desktop App (MSIX — Microsoft Store)

Builds `Zulivio-<version>.0-x64.msix`, a standalone Windows desktop build of
Zulivio. Opening it starts an **embedded PostgreSQL instance**, the NestJS
backend, and the Next.js frontend as its own child processes, and shows the
app in its own window via WebView2 — no Docker, no separate database server,
no browser tab, nothing to install first beyond Windows itself (WebView2
ships with Windows 11 and current Windows 10 by default).

> This is a second, independent deployment target. It does not touch, replace,
> or depend on `compose.yaml` or `casaos/docker-compose.yml` — those keep
> working exactly as before. Nothing in `apps/backend/src` or `apps/web/src`
> changed for this except one additive line in `apps/backend/src/main.ts`
> (a `HOST` env var, defaulting to the existing `0.0.0.0` so Docker/CasaOS are
> unaffected — see that file).

Modeled directly on the identical MSIX packaging already shipped for
[nodedr-pos](https://github.com/Raktim94/nodedr-pos/blob/master/packaging/windows/README.md)
— same WebView2-launcher architecture, same CI discipline (built AND tested
on a real Windows runner, not cross-built from Linux). The one real
architectural difference: nodedr-pos uses SQLite (a single file, no server
process); Zulivio's Prisma schema is hard-wired to PostgreSQL, so this
package also embeds and manages a real PostgreSQL 16 instance — see
"Why PostgreSQL is embedded, not swapped for SQLite" below.

## Why this is built on a Windows CI runner, not cross-built from Linux

`argon2` (password hashing) is a native Node addon whose compiled binary is
platform- and ABI-specific, and Prisma's query engine is a platform-specific
executable. Building on `windows-latest` means `prisma generate` produces the
Windows engine and argon2's native addon is verified to actually load — and,
the part that matters most, **the package can be installed, exercised, and
uninstalled on real Windows** before anyone downloads it. See
`.github/workflows/build-windows-msix.yml`.

## Why PostgreSQL is embedded, not swapped for SQLite

Zulivio's `schema.prisma` datasource is `provider = "postgresql"`, used by
every deployment (Docker Compose, CasaOS). Porting the desktop build to
SQLite would mean a second, divergent Prisma schema/migration history and an
audit of every Postgres-specific behavior already relied on — real, ongoing
risk of the desktop build silently drifting from what's actually shipped and
tested everywhere else. Embedding real PostgreSQL 16 binaries instead keeps
one schema, one migration history, and byte-identical behavior across every
deployment target, at the cost of a larger package and a real (if small)
database lifecycle to manage — see `packaging/windows/msix/launcher/Program.cs`'s
`StartPostgresAsync`/`StopPostgresGracefully`.

## What's different from the Docker/CasaOS deployment

| Docker / CasaOS | MSIX desktop build |
| --- | --- |
| `postgres:16-alpine` container, credentials in `.env` | Embedded PostgreSQL, `trust` auth on `127.0.0.1` only (no LAN exposure exists to protect against — no password to generate, store, or rotate) |
| Migrations run once via a separate `migrate` service / inline `&&` | Runs `prisma migrate deploy` on every start (idempotent — a no-op after the first) |
| Backend binds `0.0.0.0` (must be, for container networking) | Backend binds `127.0.0.1` only via the new `HOST` env var |
| Always-on, reachable from the LAN while "closed" (it's a server) | Foreground-only — opening the app starts everything, closing it stops everything. No firewall rules opened. |
| `FIELD_ENCRYPTION_KEY_PATH`/`UPLOADS_DIR` default to a container path | Both set explicitly to `C:\ProgramData\Zulivio\...` (the backend's own defaults are relative to `process.cwd()`, which would otherwise land inside the read-only MSIX install root) |

Everything else — auth, RBAC, leads/pipeline, attendance, the whole app — is
unmodified application code.

## Layout once installed

```
<MSIX install root>\
  runtime\node.exe                bundled Node.js
  pgsql\bin\{initdb,pg_ctl,postgres,createdb}.exe   embedded PostgreSQL
  backend\
    node_modules\                 workspace-root hoisted deps
    apps\backend\{node_modules,dist,prisma,package.json}
  frontend\                       Next.js standalone output (path to server.js
                                   varies — see build-msix.ps1's discovery step)
  msix-wrappers\backend-service.js
  zulivio.exe                     the WebView2-hosted launcher

C:\ProgramData\Zulivio\
  pgdata\                         PostgreSQL data directory
  uploads\                        knowledge-base/backup file uploads
  secrets\field-encryption.key    auto-generated on first use
  logs\{launcher,backend,frontend,postgres}.log
  webview2-data\                  WebView2's per-app profile
```

Neither the install root nor `C:\ProgramData\Zulivio` contains a space,
deliberately — those paths end up inside a Postgres connection URL, process
arguments, and batch-adjacent quoting, where spaces are a recurring source of
bugs.

## Why `pnpm install --node-linker=hoisted` for this build specifically

Zulivio is a pnpm+Turborepo monorepo. pnpm's default ("isolated") linker
represents most of `node_modules` as symlinks into a `.pnpm` virtual store.
MSIX packages have no verified-from-this-build-environment guarantee that
`makeappx` copies through symlinked directories/NTFS junctions intact, so
`build-msix.ps1` installs the workspace with `--node-linker=hoisted`
instead — a flat, ordinary `node_modules` tree with no reparse points
anywhere, exactly what a plain `npm install` would have produced. This flag
is scoped to the fresh checkout this script runs in; it does not touch
`pnpm-workspace.yaml` or affect the normal dev/Docker workflow.

## Ports

| What | Port | Bind |
| --- | --- | --- |
| Frontend (WebView2 navigates here) | 3100 | `127.0.0.1` |
| Backend API | 4100 | `127.0.0.1` |
| Embedded PostgreSQL | 54329 | `127.0.0.1` |

All three are loopback-only. No firewall rules are created or needed.

## What the CI build verifies on real Windows

Every build installs the MSIX, launches it, and fails if any of this breaks:

| Check |
| --- |
| Silent install via `Add-AppxPackage` |
| Backend answers `/api/health/ready` (proves Postgres started, `migrate deploy` succeeded, DB reachable) |
| `zulivio.exe`'s own WebView2 control actually initialized (a distinct check from the HTTP health check — see `build-windows-msix.yml`'s comment on why) |
| **Functional test**: `POST /api/v1/bootstrap` creates an organization + master owner, `POST /api/v1/auth/sessions` logs in and sets a session cookie, the frontend root page renders |
| Process tree: `zulivio.exe` + exactly 2 `node.exe` + at least 1 `postgres.exe` |
| All three ports (3100/4100/54329) bound to `127.0.0.1` only, never `0.0.0.0`/`::` |
| Closing the app stops every child process — no orphaned `node.exe` or `postgres.exe` |
| Silent uninstall removes the package and every process, but **preserves** `C:\ProgramData\Zulivio` (see the data-retention note in `build-windows-msix.yml`'s uninstall step) |
| Windows App Certification Kit, best-effort |

## Package identity — from Partner Center, not invented

Neither `AppxManifest.xml.template` nor `build-msix.ps1` hardcodes a package
identity. Get the real values from **Partner Center → your app → Product
management → App identity**:

- **Package/Identity Name** → `-PackageIdentityName` / `$env:ZULIVIO_MSIX_IDENTITY_NAME`
- **Publisher ID** (a `CN=...` string) → `-PublisherCn` / `$env:ZULIVIO_MSIX_PUBLISHER_CN`

`build-msix.ps1` refuses to run if either is missing or still a placeholder.
**Status as of this writing: no Partner Center product exists yet for
Zulivio** — CI builds and fully smoke-tests under an obvious
`ZulivioCITestOnly` placeholder identity so the pipeline itself stays
exercised; that output must never be uploaded to Partner Center. Once a
Partner Center product is created, set `ZULIVIO_MSIX_IDENTITY_NAME` /
`ZULIVIO_MSIX_PUBLISHER_CN` as repository secrets (`gh secret set ...`).

## Building

### On GitHub (recommended — this is also how it's tested)

```bash
gh workflow run build-windows-msix.yml \
  -f version=1.0.0 \
  -f release_tag=v1.0.0        # omit to just produce an artifact
```

### Locally, on a Windows machine

Requires Windows x64, Node ≥24 on `PATH`, the .NET SDK, and the Windows SDK
(`makeappx.exe`/`signtool.exe` — ships with Visual Studio Build Tools).

```powershell
pwsh -File packaging\windows\build-msix.ps1 `
  -Version 1.0.0 `
  -PackageIdentityName "ZulivioCITestOnly" `
  -PublisherCn "CN=Zulivio-CI-Test-Only" `
  -SelfSignForTesting
# -> dist\Zulivio-1.0.0.0-x64.msix
```

### Local testing

```powershell
Import-Certificate -FilePath dist\zulivio-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name AllowAllTrustedApps -Value 1

Add-AppxPackage -Path dist\Zulivio-1.0.0.0-x64.msix

Start-Process shell:AppsFolder\$(Get-AppxPackage -Name "*Zulivio*").PackageFamilyName!Zulivio
# A window should open showing Zulivio's own bootstrap/login screen (no
# browser tab). Closing the window should end zulivio.exe, both node.exe
# children, and postgres.exe (check Task Manager).

$pkg = Get-AppxPackage -Name "*Zulivio*"
Remove-AppxPackage -Package $pkg.PackageFullName        # uninstall check
```

## Data, upgrades, and removal

- The embedded database, uploads, and encryption key live in
  `C:\ProgramData\Zulivio`, outside the installed package.
- Installing a newer version replaces the package; `msix-wrappers/
  backend-service.js` runs `prisma migrate deploy` on every start, so an
  upgrade's new migrations apply automatically the next time the app opens.
- **Uninstall keeps the database** — same convention as nodedr-pos, and the
  same reasoning any installed database/Docker Desktop-style app follows
  (removing the application isn't the same action as asking to erase your
  data). If Zulivio should instead offer to erase everything on request,
  that needs an explicit in-app "Uninstall & erase all data" action — MSIX
  itself has no uninstall-time hook to run cleanup code. Not built here;
  flagged as a decision to confirm, not assumed.

## Code signing / Store submission

MSIX needs no CA-trusted code-signing certificate for the actual Store
upload — Partner Center re-signs with a Microsoft certificate automatically
after certification passes. `-SelfSignForTesting` is for local/CI
installability only and must be **omitted** from the file actually uploaded
to Partner Center.

**Certification risks — not guaranteed, and not yet exercised end-to-end:**

- `runFullTrust` is a restricted capability, reviewed case by case — but the
  single most common one in the Store (every classic Win32 app packaged as
  MSIX needs it), same as nodedr-pos's now-approved listing.
- This is a genuinely foreground-only, single-machine app — if Partner
  Center's functional review expects an "install once, always reachable"
  shape (the way the Docker/CasaOS deployment behaves), call out the
  foreground-only scope explicitly in the certification notes.
- The WebView2-missing fallback path (`Program.cs`'s
  `WebView2RuntimeNotFoundException` handler) is real code but has not been
  exercised on a machine that's actually missing the runtime — every CI
  runner image already has it (bundled with Edge).
- The exact PostgreSQL download URL/version pinned in `build-msix.ps1` was
  chosen without network access to verify it from this development
  environment — the first real CI run is the actual verification; if it
  404s, check https://www.enterprisedb.com/download-postgresql-binaries for
  the current URL pattern and update `-PostgresVersion`/`-PostgresBaseUrl`.
- **PostgreSQL running under an Administrator account.** `postgres.exe`
  refuses to run directly as a member of the Administrators group — but
  `pg_ctl`/`postgres` on Windows handle this automatically by re-executing
  themselves under an internally-created *restricted token* that drops
  admin membership, specifically so normal admin users can still run it.
  GitHub's `windows-latest` runner account is an admin-equivalent account,
  so every CI run already exercises this path — if it were fundamentally
  broken for that runner image, `StartPostgresAsync` would fail loudly and
  the build would fail (not hang or silently misbehave). The historically
  documented failure mode of this mechanism is a data-directory path
  containing spaces/quoting edge cases — avoided here deliberately by using
  `C:\ProgramData\Zulivio\pgdata` (no spaces), matching nodedr-pos's own
  "no spaces in any install/data path" rule. Many real end users are local
  Administrators on their own PC, so this same mechanism runs on their
  machine too, not just in CI.

## Notes for certification (suggested text for Store reviewers)

> Zulivio is a single-machine, self-contained workforce-operations CRM.
> Opening it starts its own local database (embedded PostgreSQL), backend,
> and web server as child processes — all bound to 127.0.0.1 only, no
> network services, no LAN exposure in this Store build — and displays the
> app in this app's own window via WebView2; closing the window stops all of
> them. No pre-seeded test account exists — the first launch shows a
> "Create your organization" screen; create an account there to exercise
> leads, pipeline, employees, and attendance. This package declares
> `runFullTrust` because it launches local Node.js and PostgreSQL processes
> as part of its normal operation — it installs and runs no system service
> and requests no other restricted capability.
