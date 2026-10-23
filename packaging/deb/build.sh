#!/usr/bin/env bash
umask 022
# Builds <pkg>_<version>_<arch>.deb for amd64 and arm64 (or one arch). The package installs a systemd service that
# runs the published, version-pinned container images with Docker Compose; it does not bundle the app itself.
# Usage: packaging/deb/build.sh <version> [amd64|arm64]     Output: dist/ (override with OUT_DIR)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../.." && pwd)
. "$here/product.conf"
ver="${1:?version, e.g. 1.2.3}"; ver="${ver#v}"
archs="${2:-amd64 arm64}"; out="${OUT_DIR:-$root/dist}"; mkdir -p "$out"
for arch in $archs; do
  stage=$(mktemp -d); pkg="$stage/p"
  mkdir -p "$pkg/DEBIAN" "$pkg/usr/lib/$PKG" "$pkg/etc/$PKG" "$pkg/lib/systemd/system" "$pkg/usr/share/doc/$PKG"
  sed "s/@VERSION@/$ver/g" "$here/docker-compose.yml" > "$pkg/usr/lib/$PKG/docker-compose.yml"
  sed "s/@VERSION@/$ver/g" "$here/$PKG.env" > "$pkg/etc/$PKG/$PKG.env"
  install -m 0644 "$here/$PKG.service" "$pkg/lib/systemd/system/$PKG.service"
  install -m 0644 "$root/LICENSE" "$pkg/usr/share/doc/$PKG/copyright"
  printf '%s (%s) stable; urgency=medium\n\n  * %s %s. See %s\n\n -- Raktim Ranjit <ranjitraktim5@gmail.com>  %s\n' "$PKG" "$ver" "$TITLE" "$ver" "$DOCS" "$(date -R)" | gzip -9n > "$pkg/usr/share/doc/$PKG/changelog.Debian.gz"
  echo "/etc/$PKG/$PKG.env" > "$pkg/DEBIAN/conffiles"
  for s in postinst prerm postrm; do install -m 0755 "$here/$s" "$pkg/DEBIAN/$s"; done
  find "$pkg" -type d -exec chmod 0755 {} +
  size=$(du -sk "$pkg" | cut -f1)
  cat > "$pkg/DEBIAN/control" <<CTL
Package: $PKG
Version: $ver
Section: web
Priority: optional
Architecture: $arch
Installed-Size: $size
Depends: docker.io | docker-ce, docker-compose-v2 | docker-compose-plugin, systemd, curl
Maintainer: Raktim Ranjit <ranjitraktim5@gmail.com>
Homepage: $HOMEPAGE
Description: $SHORTDESC
$LONGDESC
CTL
  f="$out/${PKG}_${ver}_${arch}.deb"
  dpkg-deb --root-owner-group -Zxz --build "$pkg" "$f" >/dev/null
  ( cd "$out" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" )
  rm -rf "$stage"; echo "$f"
done
