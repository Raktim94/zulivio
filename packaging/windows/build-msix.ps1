<#
.SYNOPSIS
  Builds the Zulivio MSIX package for Microsoft Store submission
  (Zulivio-<version>.0-x64.msix).

.DESCRIPTION
  MUST run on Windows x64. Reasons, all native to this specific app:
    - `argon2` (password hashing) is a native Node addon — its compiled
      binary is platform- and ABI-specific.
    - Prisma's query engine is a platform-specific executable; running
      `prisma generate` on Windows is what produces the Windows engine.
    - This script also needs the dotnet SDK (to publish the WebView2
      launcher) and makeappx.exe/signtool.exe from the Windows SDK — all
      three are Windows-only tools.

  Unlike a typical single-package Node app, Zulivio is a pnpm+Turborepo
  monorepo (apps/backend, apps/web, packages/types). This script installs
  the whole workspace with `--node-linker=hoisted` specifically so the
  resulting node_modules is a flat, ordinary directory tree with NO
  symlinks or NTFS junctions anywhere in it (pnpm's default "isolated"
  linker represents most of node_modules as symlinks into a `.pnpm` virtual
  store) — MSIX packages do not reliably support reparse points, and
  `makeappx` has no documented, verified-from-this-build-environment
  guarantee it copies through symlinked directories intact. Hoisted mode
  sidesteps the question entirely: what's on disk after `pnpm install` here
  is exactly what an old-style `npm install` would have produced, and
  that's what gets copied into the payload. This flag only affects the
  install performed by *this script*, in a fresh checkout of the repo (a
  GitHub Actions workspace) — it does not touch pnpm-workspace.yaml or
  affect the normal dev/Docker workflow.

  This is architecturally distinct from Docker/CasaOS on purpose (see
  packaging/windows/README.md's "MSIX" section): no PostgreSQL server
  container, no NestJS "migrate" one-shot service — this build EMBEDS a
  real, unmodified PostgreSQL for Windows (downloaded, checksummed for
  size/shape sanity, and verified to contain the expected binaries before
  packaging) and a small WebView2-hosted launcher
  (packaging/windows/msix/launcher/) that starts Postgres, the backend, and
  the frontend as its own plain child processes when opened, and stops all
  three when closed.

  Package identity (Name + Publisher CN) is intentionally NOT hardcoded
  anywhere in this repo — it comes from Partner Center -> your app ->
  Product management -> App identity, and must be passed in explicitly.

.EXAMPLE
  pwsh -File packaging\windows\build-msix.ps1 `
    -Version 1.0.0 `
    -PackageIdentityName "12345Publisher.Zulivio" `
    -PublisherCn "CN=A1B2C3D4-...-...-...-..." `
    -SelfSignForTesting
#>
[CmdletBinding()]
param(
  [string]$Version             = "1.0.0",
  [string]$NodeVersion          = "26.5.0",
  # PostgreSQL major version pinned to match postgres:16-alpine used by
  # compose.yaml/casaos/docker-compose.yml, so schema/behavior stays
  # identical across every deployment target. The full version+build
  # string and download URL below are NOT verified from this (Linux, no
  # internet) build environment — see the "Embedding PostgreSQL" step for
  # what to check first if this 404s on a real CI run.
  [string]$PostgresVersion      = "16.4-1",
  [string]$PostgresBaseUrl      = "https://get.enterprisedb.com/postgresql",
  [int]$BackendPort            = 4100,
  [int]$FrontendPort           = 3100,
  [int]$PostgresPort           = 54329,
  [string]$OutDir              = "dist",
  [string]$PackageIdentityName = $env:ZULIVIO_MSIX_IDENTITY_NAME,
  [string]$PublisherCn         = $env:ZULIVIO_MSIX_PUBLISHER_CN,
  # Local-testing convenience only. NEVER used for the actual Store
  # submission — Partner Center re-signs with a Microsoft certificate after
  # certification, which is the entire reason MSIX avoids needing a
  # purchased trusted-root code-signing cert.
  [switch]$SelfSignForTesting
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PkgDir   = $PSScriptRoot
$MsixDir  = Join-Path $PkgDir "msix"
$Work     = Join-Path ([System.IO.Path]::GetTempPath()) "zulivio-msix-$(Get-Random)"
$Payload  = Join-Path $Work "payload"
$OutPath  = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $RepoRoot $OutDir }
New-Item -ItemType Directory -Force -Path $Work, $Payload, $OutPath | Out-Null

Step "Preflight"
if ([string]::IsNullOrWhiteSpace($PackageIdentityName) -or $PackageIdentityName -eq "@PACKAGE_IDENTITY_NAME@") {
  Die "PackageIdentityName is required. Get it from Partner Center -> your app -> Product management -> App identity, then pass -PackageIdentityName or set `$env:ZULIVIO_MSIX_IDENTITY_NAME. Do not invent one."
}
if ([string]::IsNullOrWhiteSpace($PublisherCn) -or $PublisherCn -eq "@PARTNER_CENTER_PUBLISHER_CN@") {
  Die "PublisherCn is required. Same Partner Center page as above ('Publisher ID', a CN=... string), then pass -PublisherCn or set `$env:ZULIVIO_MSIX_PUBLISHER_CN. Do not invent one."
}
Info "identity  $PackageIdentityName"
Info "publisher $PublisherCn"
Info "version   $Version.0"
Info "ports     web $FrontendPort, api (loopback) $BackendPort, postgres (loopback) $PostgresPort"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "node is required on PATH to bootstrap the build" }

# ---------------------------------------------------------------------------
# 1. Node.js runtime — same version/verification approach as nodedr-pos's
#    build-windows.ps1: fetch, then verify against upstream's own published
#    checksums before trusting it.
# ---------------------------------------------------------------------------
Step "Fetching the Node.js runtime"
$NodeZip = "node-v$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"
$NodeDl  = Join-Path $Work $NodeZip
Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeDl -UseBasicParsing

$Shasums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$Expected = ($Shasums -split "`n" | Where-Object { $_ -match [regex]::Escape($NodeZip) } | Select-Object -First 1) -split '\s+' | Select-Object -First 1
if (-not $Expected) { Die "$NodeZip is not listed in upstream SHASUMS256.txt" }
$Actual = (Get-FileHash -Path $NodeDl -Algorithm SHA256).Hash.ToLower()
if ($Actual -ne $Expected.ToLower()) { Die "checksum mismatch for $NodeZip`n  expected $Expected`n  actual   $Actual" }
Ok "checksum verified"

Expand-Archive -Path $NodeDl -DestinationPath $Work -Force
$NodeHome = Join-Path $Work "node-v$NodeVersion-win-x64"
$NodeExe  = Join-Path $NodeHome "node.exe"
if (-not (Test-Path $NodeExe)) { Die "extracted runtime has no node.exe" }

$env:PATH = "$NodeHome;$env:PATH"
$env:npm_config_update_notifier = "false"
$env:NPM_CONFIG_FUND  = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:CHECKPOINT_DISABLE = "1"
$env:CI = "1"
Ok "node $(& $NodeExe -v), abi $(& $NodeExe -p 'process.versions.modules')"

# ---------------------------------------------------------------------------
# 2. Embedding PostgreSQL — a real, unmodified upstream portable build, not
#    a reimplementation. See this file's header comment for the version-pin
#    caveat: this URL has NOT been verified from this (Linux, no internet)
#    build environment. If this step 404s on a real CI run, check
#    https://www.enterprisedb.com/download-postgresql-binaries for the
#    current URL pattern/version and update -PostgresVersion/-PostgresBaseUrl.
# ---------------------------------------------------------------------------
Step "Fetching embedded PostgreSQL $PostgresVersion (Windows x64 binaries)"
$PgZipName = "postgresql-$PostgresVersion-windows-x64-binaries.zip"
$PgUrl     = "$PostgresBaseUrl/$PgZipName"
$PgDl      = Join-Path $Work $PgZipName
Invoke-WebRequest -Uri $PgUrl -OutFile $PgDl -UseBasicParsing
$PgZipSizeMb = [math]::Round((Get-Item $PgDl).Length / 1MB, 1)
if ($PgZipSizeMb -lt 50) { Die "downloaded PostgreSQL zip is only $PgZipSizeMb MB — too small to be the real binaries package; the download likely returned an error page. Check $PgUrl in a browser." }
Info "downloaded $PgZipName ($PgZipSizeMb MB)"
$PgExtract = Join-Path $Work "pgsql-extract"
Expand-Archive -Path $PgDl -DestinationPath $PgExtract -Force
# The official zip's top-level folder is named "pgsql" already; locate it
# rather than hardcoding, in case a future version's zip layout differs.
$PgSourceRoot = Get-ChildItem -Path $PgExtract -Directory | Where-Object { Test-Path (Join-Path $_.FullName "bin\postgres.exe") } | Select-Object -First 1
if (-not $PgSourceRoot) { $PgSourceRoot = Get-Item $PgExtract }
foreach ($tool in @("initdb.exe", "pg_ctl.exe", "postgres.exe", "createdb.exe")) {
  if (-not (Test-Path (Join-Path $PgSourceRoot.FullName "bin\$tool"))) {
    Die "expected $tool not found under the extracted PostgreSQL package at $($PgSourceRoot.FullName)\bin — the zip layout may have changed upstream."
  }
}
$pgSha = (Get-FileHash $PgDl -Algorithm SHA256).Hash.ToLower()
Ok "PostgreSQL binaries verified present (bin\initdb.exe, pg_ctl.exe, postgres.exe, createdb.exe). sha256 of source zip: $pgSha (not pre-pinned upstream — this build's own install+migrate+query test is the real integrity gate, see build-windows-msix.yml)"

# ---------------------------------------------------------------------------
# 3. Build the workspace — hoisted linker, see this file's header comment.
# ---------------------------------------------------------------------------
Step "Installing the workspace (pnpm, hoisted node-linker)"
Push-Location $RepoRoot
try {
  & corepack enable
  if ($LASTEXITCODE -ne 0) { Die "corepack enable failed" }
  & pnpm install --frozen-lockfile --node-linker=hoisted
  if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }
  Ok "workspace installed with a flat, non-symlinked node_modules"

  Step "Generating the Prisma client (Windows engine)"
  & pnpm --filter backend exec prisma generate
  if ($LASTEXITCODE -ne 0) { Die "prisma generate failed" }

  Info "verifying native modules load under the bundled runtime"
  & $NodeExe -e @"
const path = require('path');
const mods = ['argon2', '@prisma/client'];
for (const m of mods) {
  try { require(require.resolve(m, { paths: [process.cwd(), path.join(process.cwd(), 'apps', 'backend')] })); }
  catch (e) { console.error('FAILED ' + m + ': ' + e.message); process.exit(1); }
}
console.log('  all required native modules loaded');
"@
  if ($LASTEXITCODE -ne 0) { Die "a required native module does not load on Windows" }
  Ok "backend native modules verified"

  Step "Building the backend (nest build)"
  & pnpm --filter backend build
  if ($LASTEXITCODE -ne 0) { Die "backend build failed" }
  if (-not (Test-Path (Join-Path $RepoRoot "apps\backend\dist\src\main.js"))) { Die "backend build did not produce dist\src\main.js" }
  Ok "backend built"

  Step "Building the frontend (Next.js production build)"
  # CRITICAL: Next.js resolves rewrite destinations at BUILD time into the
  # routes manifest (next.config.ts reads BACKEND_URL at import time) — a
  # runtime env var is silently ignored, and the /api proxy would 502.
  $env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
  Info "baking API proxy destination: $env:BACKEND_URL"
  & pnpm --filter web build
  if ($LASTEXITCODE -ne 0) { Die "web build failed" }

  $routesManifestPath = Join-Path $RepoRoot "apps\web\.next\routes-manifest.json"
  if (-not (Test-Path $routesManifestPath)) { Die "apps\web\.next\routes-manifest.json not found" }
  $manifest = Get-Content $routesManifestPath -Raw
  if ($manifest -notmatch [regex]::Escape("127.0.0.1:$BackendPort")) {
    Die "the /api proxy destination was NOT baked into routes-manifest.json — the app would 502 on every API call"
  }
  Ok "frontend built, /api proxy destination verified in the routes manifest"
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# 4. Assemble the payload.
# ---------------------------------------------------------------------------
Step "Assembling the MSIX payload"

$AppRuntime  = Join-Path $Payload "runtime"
$AppBackend  = Join-Path $Payload "backend"
$AppFrontend = Join-Path $Payload "frontend"
$AppPgsql    = Join-Path $Payload "pgsql"
$WrappersDir = Join-Path $Payload "msix-wrappers"
New-Item -ItemType Directory -Force -Path $AppRuntime, $AppBackend, $AppFrontend, $AppPgsql, $WrappersDir | Out-Null

# --- Node runtime: only node.exe, npm/npx are build-time tools ---
Copy-Item $NodeExe (Join-Path $AppRuntime "node.exe")
Copy-Item (Join-Path $NodeHome "LICENSE") (Join-Path $AppRuntime "LICENSE") -ErrorAction SilentlyContinue

# --- PostgreSQL: the whole extracted tree (bin, lib, share) ---
Copy-Item (Join-Path $PgSourceRoot.FullName "*") $AppPgsql -Recurse -Force
Ok "PostgreSQL binaries staged at pgsql\"

# --- Backend: preserve the exact workspace-relative depth (backend\ +
#     backend\apps\backend\), matching apps/backend/Dockerfile's own layout
#     comment almost verbatim — Node's module resolution walks up parent
#     node_modules directories, so this hoisted-then-copied layout resolves
#     identically to the real install it was copied from. ---
Step "Staging the backend (preserving workspace-relative node_modules depth)"
Copy-Item (Join-Path $RepoRoot "node_modules") (Join-Path $AppBackend "node_modules") -Recurse
$BackendAppDir = Join-Path $AppBackend "apps\backend"
New-Item -ItemType Directory -Force -Path $BackendAppDir | Out-Null
foreach ($item in @("node_modules", "dist", "prisma", "package.json")) {
  $src = Join-Path $RepoRoot "apps\backend\$item"
  if (-not (Test-Path $src)) { Die "expected apps\backend\$item not found — did the backend build succeed?" }
  Copy-Item $src (Join-Path $BackendAppDir $item) -Recurse -Force
}
Ok "backend staged"

# --- Frontend: Next standalone output. In a monorepo, `server.js` is NOT
#     necessarily at the standalone root — Next preserves the path from the
#     detected workspace root down to the app (e.g. apps\web\server.js).
#     Locate it rather than assume, so this doesn't silently break if a
#     future Next.js version changes exactly how deep that nesting goes. ---
Step "Staging the frontend (Next.js standalone output)"
$StandaloneRoot = Join-Path $RepoRoot "apps\web\.next\standalone"
if (-not (Test-Path $StandaloneRoot)) { Die "apps\web\.next\standalone not found — is output:'standalone' still set in apps\web\next.config.ts?" }
$ServerJs = Get-ChildItem -Path $StandaloneRoot -Recurse -Filter "server.js" | Select-Object -First 1
if (-not $ServerJs) { Die "no server.js found anywhere under apps\web\.next\standalone" }
$ServerRelative = $ServerJs.FullName.Substring($StandaloneRoot.Length + 1).Replace('\', '/')
$ServerDirRelative = Split-Path $ServerRelative -Parent
Info "standalone server.js found at: $ServerRelative"

Copy-Item (Join-Path $StandaloneRoot "*") $AppFrontend -Recurse -Force

$StaticDest = if ($ServerDirRelative) { Join-Path $AppFrontend "$ServerDirRelative\.next\static" } else { Join-Path $AppFrontend ".next\static" }
New-Item -ItemType Directory -Force -Path (Split-Path $StaticDest -Parent) | Out-Null
Copy-Item (Join-Path $RepoRoot "apps\web\.next\static") $StaticDest -Recurse -Force

$PublicSrc = Join-Path $RepoRoot "apps\web\public"
$PublicDest = if ($ServerDirRelative) { Join-Path $AppFrontend "$ServerDirRelative\public" } else { Join-Path $AppFrontend "public" }
if (Test-Path $PublicSrc) {
  Copy-Item $PublicSrc $PublicDest -Recurse -Force
} else {
  New-Item -ItemType Directory -Force -Path $PublicDest | Out-Null
}
if (-not (Test-Path (Join-Path $AppFrontend $ServerRelative))) { Die "server.js missing from the assembled frontend payload after copy" }
Ok "frontend staged (entry: frontend\$ServerRelative)"

# --- Backend entry-point wrapper ---
Step "Writing the backend entry-point wrapper"
Copy-Item (Join-Path $MsixDir "backend-service.js.template") (Join-Path $WrappersDir "backend-service.js")
Ok "wrapper written to msix-wrappers\backend-service.js"

# ---------------------------------------------------------------------------
# 5. Visual assets, generated fresh each build from the app's own logo.
# ---------------------------------------------------------------------------
Step "Generating MSIX visual assets"
$logo = Join-Path $RepoRoot "apps\web\public\logo.png"
if (-not (Test-Path $logo)) { Die "source logo not found at $logo" }

Add-Type -AssemblyName System.Drawing
$AssetsDir = Join-Path $Payload "Assets"
New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null

function New-SquareAsset($srcPath, $destPath, $size) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-WideAsset($srcPath, $destPath, $width, $height) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $side = $height
  $x = [int](($width - $side) / 2)
  $g.DrawImage($src, $x, 0, $side, $side)
  $g.Dispose()
  $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-SquareAsset $logo (Join-Path $AssetsDir "Square44x44Logo.png") 44
New-SquareAsset $logo (Join-Path $AssetsDir "Square71x71Logo.png") 71
New-SquareAsset $logo (Join-Path $AssetsDir "Square150x150Logo.png") 150
New-SquareAsset $logo (Join-Path $AssetsDir "StoreLogo.png") 50
New-WideAsset   $logo (Join-Path $AssetsDir "Wide310x150Logo.png") 310 150
Ok "assets generated from apps\web\public\logo.png — visually spot-check on Windows before submitting; not verified from this build environment"

# ---------------------------------------------------------------------------
# 6. Build the launch target (zulivio.exe).
# ---------------------------------------------------------------------------
Step "Building the launch target (zulivio.exe)"
$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnetCmd) { Die "dotnet SDK not found — expected on every windows-latest runner" }

$LauncherDir = Join-Path $MsixDir "launcher"
$LauncherWork = Join-Path $Work "launcher-src"
Copy-Item $LauncherDir $LauncherWork -Recurse
$programCsPath = Join-Path $LauncherWork "Program.cs"
$programCs = (Get-Content $programCsPath -Raw).
  Replace("@BACKEND_PORT@", "$BackendPort").
  Replace("@FRONTEND_PORT@", "$FrontendPort").
  Replace("@POSTGRES_PORT@", "$PostgresPort").
  Replace("@FRONTEND_ENTRY@", $ServerRelative)
Set-Content -Path $programCsPath -Value $programCs -Encoding UTF8

$LauncherPublish = Join-Path $Work "launcher-publish"
& dotnet publish (Join-Path $LauncherWork "ZulivioLauncher.csproj") -c Release -p:Platform=x64 -p:Prefer32Bit=false -o $LauncherPublish
if ($LASTEXITCODE -ne 0) { Die "dotnet publish failed for the Zulivio launcher" }
if (-not (Test-Path (Join-Path $LauncherPublish "zulivio.exe"))) { Die "dotnet publish did not produce zulivio.exe" }

# ---------------------------------------------------------------------------
# Architecture guardrail — same reasoning and same raw PE/COFF header check
# as nodedr-pos's build-msix.ps1 uses for open-pos.exe: verifies zulivio.exe
# and its WebView2 native loader are genuinely x64, not AnyCPU/MSIL (which
# defaults to a 32-bit process without explicit PlatformTarget). A mismatch
# here reproduces Microsoft Store certification error 0x8007000B — this
# build stops instead of packaging a broken MSIX.
# ---------------------------------------------------------------------------
function Get-PEMachineType($path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
  return $machine
}
$IMAGE_FILE_MACHINE_AMD64 = 0x8664

Step "Verifying launcher architecture (x64)"
$exePath = Join-Path $LauncherPublish "zulivio.exe"
$exeMachine = Get-PEMachineType $exePath
Info ("zulivio.exe machine type: 0x{0:X4}" -f $exeMachine)
if ($exeMachine -ne $IMAGE_FILE_MACHINE_AMD64) {
  Die ("zulivio.exe is not a genuine x64 image (machine type 0x{0:X4}, expected 0x{1:X4} AMD64). Check ZulivioLauncher.csproj's PlatformTarget/Prefer32Bit and this dotnet publish command's -p:Platform flag." -f $exeMachine, $IMAGE_FILE_MACHINE_AMD64)
}
Ok "zulivio.exe is genuinely x64"

$loaderPath = Join-Path $LauncherPublish "WebView2Loader.dll"
if (-not (Test-Path $loaderPath)) { Die "WebView2Loader.dll missing from the launcher publish output" }
$loaderMachine = Get-PEMachineType $loaderPath
if ($loaderMachine -ne $IMAGE_FILE_MACHINE_AMD64) {
  Die ("WebView2Loader.dll is not x64 (machine type 0x{0:X4}, expected 0x{1:X4})." -f $loaderMachine, $IMAGE_FILE_MACHINE_AMD64)
}
Ok "WebView2Loader.dll is x64"

Copy-Item (Join-Path $LauncherPublish "*") $Payload -Recurse -Force
Remove-Item (Join-Path $Payload "zulivio.pdb") -Force -ErrorAction SilentlyContinue
Ok "zulivio.exe published"

# ---------------------------------------------------------------------------
# 7. Manifest.
# ---------------------------------------------------------------------------
Step "Writing AppxManifest.xml"
$manifest = Get-Content (Join-Path $MsixDir "AppxManifest.xml.template") -Raw
$manifest = $manifest.
  Replace("@PACKAGE_IDENTITY_NAME@", $PackageIdentityName).
  Replace("@PARTNER_CENTER_PUBLISHER_CN@", $PublisherCn).
  Replace("@VERSION@", $Version).
  Replace("@FRONTEND_PORT@", "$FrontendPort")
Set-Content -Path (Join-Path $Payload "AppxManifest.xml") -Value $manifest -Encoding UTF8
Ok "manifest written"

# ---------------------------------------------------------------------------
# 8. Pack.
# ---------------------------------------------------------------------------
Step "Packing the MSIX"
$makeappx = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\makeappx.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $makeappx) {
  $sdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $sdkBin) {
    $makeappx = Get-ChildItem $sdkBin -Directory | Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\makeappx.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
}
if (-not $makeappx) { Die "makeappx.exe not found. Install the Windows SDK (present by default on windows-latest GitHub runners)." }
Info "using $makeappx"

$MsixName = "Zulivio-$Version.0-x64.msix"
$MsixPath = Join-Path $OutPath $MsixName
& $makeappx pack /d $Payload /p $MsixPath /o
if ($LASTEXITCODE -ne 0) { Die "makeappx pack failed" }
if (-not (Test-Path $MsixPath)) { Die "MSIX was not produced at $MsixPath" }
Ok "packed $MsixName"

# ---------------------------------------------------------------------------
# 9. Local-testing signature only (never for Store submission).
# ---------------------------------------------------------------------------
if ($SelfSignForTesting) {
  Step "Self-signing for LOCAL TESTING ONLY (not the Store submission)"
  $signtool = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\signtool.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $signtool) {
    $sdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $signtool = Get-ChildItem $sdkBin -Directory | Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if (-not $signtool) { Die "signtool.exe not found (Windows SDK)" }

  $certPath = Join-Path $Work "zulivio-test.pfx"
  $certPassword = ConvertTo-SecureString -String "zulivio-test" -Force -AsPlainText
  $cert = New-SelfSignedCertificate -Type Custom -Subject $PublisherCn `
    -KeyUsage DigitalSignature -FriendlyName "Zulivio test signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $certPassword | Out-Null
  & $signtool sign /fd SHA256 /f $certPath /p "zulivio-test" $MsixPath
  if ($LASTEXITCODE -ne 0) { Die "signtool failed to sign the test package" }
  Ok "signed for local testing with a self-signed cert (Subject: $PublisherCn)"
  $cerPath = Join-Path $OutPath "zulivio-test.cer"
  Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
  Write-Host ""
  Write-Host "Before Add-AppxPackage will accept this, trust the test cert once:" -ForegroundColor Yellow
  Write-Host "  Import-Certificate -FilePath `"$cerPath`" -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
}

$sizeMb = [math]::Round((Get-Item $MsixPath).Length / 1MB, 1)
$sha = (Get-FileHash $MsixPath -Algorithm SHA256).Hash.ToLower()

Write-Host ""
Write-Host "Built $MsixName ($sizeMb MB)" -ForegroundColor Green
Write-Host "  $MsixPath"
Write-Host "  sha256 $sha"
Write-Host ""
Write-Host "This is the file to upload to Partner Center — Store submission does NOT"
Write-Host "need this signed with a trusted-root cert; Microsoft re-signs it after"
Write-Host "certification passes."

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
