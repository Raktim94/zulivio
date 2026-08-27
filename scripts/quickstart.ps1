# Zulivio quickstart — Windows (PowerShell).
#
# Never installs Docker Desktop. The Docker CLI and Docker Desktop are two
# different things: the CLI alone can't run a container without a Docker
# Engine somewhere to talk to. Instead of Docker Desktop, this script uses
# WSL2 — Windows' own free, built-in Linux subsystem — to run a real,
# open-source Docker Engine + Docker CLI (installed the exact same way this
# project's Linux quickstart.sh already installs it), then runs that same
# quickstart.sh inside WSL2 to install and start Zulivio. It also installs
# the native Windows Docker CLI (winget: Docker.DockerCLI) so `docker`
# exists as a plain PowerShell command too, alongside the one running
# inside WSL2.
#
# Usage (run in PowerShell):
#   irm https://raw.githubusercontent.com/Raktim94/zulivio/main/scripts/quickstart.ps1 | iex
#
# Safe to re-run: every step only acts if the previous one didn't already
# succeed, and an existing checkout inside WSL2 is updated in place rather
# than re-cloned.
#
# One real limitation this script can't script around: if WSL2 has never
# been turned on on this PC before, Windows needs ONE restart to finish
# enabling the underlying virtualization feature. If this script tells you
# to restart, do that, then run this exact same command again — it picks up
# right where it left off, automatically.

$ErrorActionPreference = "Stop"
Set-Location $HOME

$distroName = "Ubuntu"
$repoDir = "zulivio"
$linuxQuickstartUrl = "https://raw.githubusercontent.com/Raktim94/zulivio/main/scripts/quickstart.sh"

# winget writes new PATH entries to the Machine/User registry values, but
# this already-running PowerShell process keeps its own stale copy of
# $env:Path — re-reading both scopes and rebuilding $env:Path is the same
# fix Windows itself applies the next time you open a new terminal.
function Update-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# `wsl -l -q` pipes its output as UTF-16LE, which PowerShell renders with a
# stray null byte after every character — strip those before comparing names.
function Get-FirstWslDistro {
    $raw = (wsl.exe -l -q 2>$null)
    if (-not $raw) { return $null }
    $names = $raw | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ -ne "" }
    return $names | Select-Object -First 1
}

Write-Host "==> Checking for WSL2 (this replaces Docker Desktop)..."
$wslReady = $false
try { wsl.exe --status *> $null; $wslReady = ($LASTEXITCODE -eq 0) } catch { $wslReady = $false }
$existingDistro = if ($wslReady) { Get-FirstWslDistro } else { $null }

if (-not $existingDistro) {
    Write-Host "==> Installing WSL2 with Ubuntu..."
    wsl.exe --install -d $distroName --no-launch
    Start-Sleep -Seconds 3

    $existingDistro = Get-FirstWslDistro
    if ($existingDistro) {
        try { wsl.exe -d $existingDistro -u root -- true *> $null } catch {}
    }
    if (-not $existingDistro -or $LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "WSL2 was just installed for the first time. Windows needs ONE restart to finish turning it on." -ForegroundColor Yellow
        Write-Host "Restart your PC, then run this exact same command again — it continues automatically from here." -ForegroundColor Yellow
        exit 0
    }
}

$distroName = $existingDistro
Write-Host "Using WSL distro: $distroName"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "==> Installing the Docker CLI for Windows via winget (not Docker Desktop)..."
        winget install -e --id Docker.DockerCLI --accept-source-agreements --accept-package-agreements
        Update-SessionPath
    } else {
        Write-Host "winget isn't available, so the native Windows 'docker' command will be skipped — Zulivio will still install and run fully inside WSL2." -ForegroundColor Yellow
    }
}

Write-Host "==> Installing and starting Zulivio inside WSL2 (Docker Engine and git are installed automatically in there if needed)..."
wsl.exe -d $distroName -u root -- bash -lc "curl -fsSL $linuxQuickstartUrl | bash"

Write-Host ""
Write-Host "Zulivio is up and running." -ForegroundColor Green
Write-Host "Open the URL shown above in your Windows browser — WSL2 forwards it to localhost automatically." -ForegroundColor Green
Write-Host "To manage it later: open PowerShell and run: wsl -u root -- bash -lc `"cd ~/$repoDir && docker compose logs`"" -ForegroundColor Green
