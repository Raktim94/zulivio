#!/usr/bin/env bash
# Installs the .deb on this machine (needs root, systemd and Docker), waits for the app to answer over HTTP,
# then reinstalls, removes and purges it. Usage: sudo DEB=/path/to/pkg.deb packaging/deb/test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); . "$here/product.conf"
: "${DEB:?set DEB to the .deb path}"
step() { printf '\n== %s\n' "$*"; }
step "install with the one-command installer"; DEB_FILE="$DEB" bash "$here/install-linux.sh"
systemctl is-enabled "$PKG.service"
[ "$(stat -c %a "/etc/$PKG/$PKG.env")" = 600 ] || { echo "env file is not mode 600" >&2; exit 1; }
! grep -q '@SECRET@' "/etc/$PKG/$PKG.env" || { echo "unreplaced secret placeholder" >&2; exit 1; }
step "wait for http://127.0.0.1:$PORT$PATHCHECK"
ok=0; code=000
for _ in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$PATHCHECK" || true)
  case "$code" in 2*|3*) ok=1; break;; esac; sleep 5
done
if [ "$ok" != 1 ]; then
  systemctl status "$PKG.service" --no-pager || true; docker ps -a || true
  docker compose --project-name "$PROJECT" logs --tail 60 || true
  echo "app did not answer (last code $code)" >&2; exit 1
fi
echo "answered HTTP $code"
step "reinstall keeps settings"
sum=$(sha256sum "/etc/$PKG/$PKG.env"); apt-get install -y --reinstall "$DEB"
[ "$sum" = "$(sha256sum "/etc/$PKG/$PKG.env")" ] || { echo "settings changed on reinstall" >&2; exit 1; }
step "remove"; apt-get remove -y "$PKG"
! systemctl is-active --quiet "$PKG.service" || { echo "service still active after remove" >&2; exit 1; }
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")" ] || { echo "containers still running after remove" >&2; exit 1; }
[ -f "/etc/$PKG/$PKG.env" ] || { echo "settings were removed by apt remove" >&2; exit 1; }
step "purge keeps settings and data"; sum=$(sha256sum "/etc/$PKG/$PKG.env"); apt-get purge -y "$PKG"
[ -f "/etc/$PKG/$PKG.env" ] && [ "$sum" = "$(sha256sum "/etc/$PKG/$PKG.env")" ] || { echo "settings changed or vanished on purge" >&2; exit 1; }
step "reinstall after purge reuses settings and data"
DEB_FILE="$DEB" bash "$here/install-linux.sh"
[ "$sum" = "$(sha256sum "/etc/$PKG/$PKG.env")" ] || { echo "settings regenerated after purge (would not match the data volumes)" >&2; exit 1; }
ok=0; for _ in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$PATHCHECK" || true)
  case "$code" in 2*|3*) ok=1; break;; esac; sleep 5
done
[ "$ok" = 1 ] || { docker compose --project-name "$PROJECT" logs --tail 60 || true; echo "app did not answer after reinstall (last code $code)" >&2; exit 1; }
echo "answered HTTP $code after purge and reinstall"
step "clean up everything"; apt-get purge -y "$PKG"; docker compose --project-name "$PROJECT" down -v >/dev/null 2>&1 || true; rm -rf "/etc/$PKG"
echo OK
