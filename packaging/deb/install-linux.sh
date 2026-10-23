#!/usr/bin/env bash
# One-command install of Zulivio on Ubuntu or Debian (amd64 or arm64).
#
#   curl -fsSL https://zulivio.nodedr.com/install-linux.sh | sudo bash
#
# Downloads the .deb for the latest release from GitHub, checks its SHA-256, makes sure Docker and Docker Compose
# are present, and installs the package with apt. The package starts Zulivio under systemd (it runs in Docker)
# and it is then available at http://localhost:3100.
# Pin a version:  curl -fsSL https://zulivio.nodedr.com/install-linux.sh | sudo ZULIVIO_VERSION=X.Y.Z bash
# Read it first:  curl -fsSL https://zulivio.nodedr.com/install-linux.sh | less
# Use a file you already downloaded (it must sit next to its .sha256):  sudo DEB_FILE=./zulivio_X.Y.Z_amd64.deb bash install-linux.sh
set -euo pipefail

REPO="Raktim94/zulivio"
PKG="zulivio"
say() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL https://zulivio.nodedr.com/install-linux.sh | sudo bash"
[ -r /etc/os-release ] && . /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in debian:*|ubuntu:*|*:*debian*|*:*ubuntu*) ;; *) die "This installer is for Ubuntu and Debian. For other systems use Docker: https://zulivio.nodedr.com/" ;; esac
command -v apt-get >/dev/null || die "apt-get was not found."
{ command -v systemctl >/dev/null && [ -d /run/systemd/system ]; } || die "systemd is required. In a container or WSL without systemd, use Docker Compose instead: https://zulivio.nodedr.com/"

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in amd64|arm64) ;; *) die "Unsupported CPU architecture '$ARCH' (amd64 and arm64 are published)." ;; esac

export DEBIAN_FRONTEND=noninteractive
say "Installing prerequisites"
apt-get update -qq
apt-get install -y -qq curl ca-certificates >/dev/null

# Docker Engine and the Compose plugin: use what is installed, else the distribution's packages, else Docker's own repository.
if ! { command -v docker >/dev/null && docker compose version >/dev/null 2>&1; }; then
  say "Installing Docker and Docker Compose"
  if ! { apt-get install -y -qq docker.io docker-compose-v2 >/dev/null 2>&1; }; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
  fi
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Docker Compose is still unavailable. See https://docs.docker.com/engine/install/ and run this again."

WORK="$(mktemp -d /var/tmp/zulivio-install.XXXXXX)"; chmod 0755 "$WORK"; trap 'rm -rf "$WORK"' EXIT
if [ -n "${DEB_FILE:-}" ]; then
  [ -f "$DEB_FILE" ] || die "DEB_FILE '$DEB_FILE' does not exist."
  FILE="$(basename "$DEB_FILE")"; cp "$DEB_FILE" "$WORK/$FILE"
  [ -f "$DEB_FILE.sha256" ] && cp "$DEB_FILE.sha256" "$WORK/$FILE.sha256" || die "Put $FILE.sha256 next to the file so it can be verified."
else
  VERSION="${ZULIVIO_VERSION:-}"
  if [ -z "$VERSION" ]; then
    say "Finding the latest release"
    # The /releases/latest redirect has no API rate limit (shared networks get HTTP 403 from api.github.com); the API is the fallback.
    VERSION="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" 2>/dev/null | sed -n 's|.*/releases/tag/v\{0,1\}||p' || true)"
    [ -n "$VERSION" ] || VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)"
    [ -n "$VERSION" ] || die "Could not determine the latest version. Set ZULIVIO_VERSION, for example ZULIVIO_VERSION=1.12.0."
  fi
  VERSION="${VERSION#v}"
  FILE="${PKG}_${VERSION}_${ARCH}.deb"
  BASE="https://github.com/$REPO/releases/download/v${VERSION}"
  say "Downloading Zulivio $VERSION ($ARCH)"
  curl -fSL --retry 3 -o "$WORK/$FILE" "$BASE/$FILE" || die "Could not download $BASE/$FILE"
  curl -fsSL -o "$WORK/$FILE.sha256" "$BASE/$FILE.sha256" || die "Could not download the checksum file."
fi
( cd "$WORK" && sha256sum -c "$FILE.sha256" >/dev/null ) || die "Checksum mismatch: the download is damaged. Nothing was installed."
chmod 0644 "$WORK/$FILE"

say "Installing (the first start pulls the container images and can take a few minutes)"
apt-get install -y "$WORK/$FILE"
say "Done. Open http://localhost:3100  ·  status: systemctl status $PKG  ·  settings: /etc/$PKG/$PKG.env"
