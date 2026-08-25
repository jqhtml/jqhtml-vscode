#!/bin/bash
################################################################################
# build.sh - Compile and package the JQHTML VS Code extension
#
# Usage:
#   ./build.sh              # release build: no sourcemaps, packages a .vsix
#   ./build.sh --dev        # dev build: sourcemaps, compile only, no .vsix
#   ./build.sh --no-package # release compile only, no .vsix
#
# A release build compiles with tsconfig.release.json (sourceMap: false) so the
# shipped extension carries neither .js.map files nor sourceMappingURL comments.
#
# Packaging note: package.json carries the scoped npm name @jqhtml/vscode-extension
# for the internal registry, and vsce rejects scoped names. Rather than mutate the
# real manifest, this script packages from a staging copy whose name is flattened to
# jqhtml-vscode-extension - which is the name every published .vsix has carried.
################################################################################

set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$EXT_DIR/../.." && pwd)"
cd "$EXT_DIR"

MODE=release
PACKAGE=1
for arg in "$@"; do
  case "$arg" in
    --dev)        MODE=dev; PACKAGE=0 ;;
    --release)    MODE=release ;;
    --no-package) PACKAGE=0 ;;
    -h|--help)    sed -n '4,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

VERSION="$(node -p "require('$EXT_DIR/package.json').version")"
PKG_NAME=jqhtml-vscode-extension
VSIX="$PKG_NAME-$VERSION.vsix"

echo "=== JQHTML VS Code Extension: $MODE build v$VERSION ==="

# ---------------------------------------------------------------------------
# Toolchain. tsc lives at the monorepo root; vsce is not vendored anywhere, so
# fall back to npx. Neither is installed by this script - a build should not
# mutate the tracked node_modules tree.
# ---------------------------------------------------------------------------
if [ -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  TSC="$REPO_ROOT/node_modules/.bin/tsc"
elif command -v tsc >/dev/null 2>&1; then
  TSC=tsc
else
  echo "ERROR: tsc not found. Expected $REPO_ROOT/node_modules/.bin/tsc" >&2
  exit 1
fi

if [ ! -d "$EXT_DIR/node_modules/@types/vscode" ]; then
  echo "ERROR: @types/vscode is missing from $EXT_DIR/node_modules." >&2
  echo "       npm install inside the workspace installs the root tree instead of" >&2
  echo "       this package, so install it out of band and copy it in:" >&2
  echo "         mkdir -p /tmp/vsc-types && cd /tmp/vsc-types && npm init -y" >&2
  echo "         npm install @types/vscode@^1.74.0 @types/node@^16.18.126" >&2
  echo "         cp -r node_modules/@types/{vscode,node} $EXT_DIR/node_modules/@types/" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Compile
# ---------------------------------------------------------------------------
if [ "$MODE" = release ]; then
  TSCONFIG=tsconfig.release.json
else
  TSCONFIG=tsconfig.json
fi

echo "--- Compiling ($TSCONFIG)"
rm -rf out
"$TSC" -p "$TSCONFIG"

[ -f out/extension.js ] || { echo "ERROR: compile produced no out/extension.js" >&2; exit 1; }

if [ "$MODE" = release ]; then
  # A release must ship no debug residue. Fail loudly rather than shipping it.
  if compgen -G "out/*.js.map" >/dev/null || grep -rql "sourceMappingURL" out; then
    echo "ERROR: release build produced sourcemap output in out/" >&2
    exit 1
  fi
  echo "  + no sourcemaps in out/"
fi

# .version ships inside the .vsix; keep it in step with package.json
echo "$VERSION" > .version

[ "$PACKAGE" -eq 1 ] || { echo "=== Compile complete (packaging skipped) ==="; exit 0; }

# ---------------------------------------------------------------------------
# Package from a staging copy (see the scoped-name note in the header)
# ---------------------------------------------------------------------------
if [ -x "$REPO_ROOT/node_modules/.bin/vsce" ]; then
  VSCE="$REPO_ROOT/node_modules/.bin/vsce"
elif command -v vsce >/dev/null 2>&1; then
  VSCE=vsce
else
  VSCE="npx --yes @vscode/vsce"
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar --exclude=node_modules --exclude='*.vsix' --exclude=.vscode-test -cf - . \
  | (cd "$STAGE" && tar -xf -)

node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  p.name = process.argv[2];
  // "dependencies": null trips vsce; the extension has no runtime dependencies
  if (p.dependencies === null) delete p.dependencies;
  fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n");
' "$STAGE/package.json" "$PKG_NAME"

echo "--- Packaging $VSIX"
(cd "$STAGE" && $VSCE package --no-dependencies --allow-missing-repository >/dev/null)

rm -f "$EXT_DIR"/*.vsix
mv "$STAGE/$VSIX" "$EXT_DIR/$VSIX"

echo
echo "=== Build complete ==="
echo "  $EXT_DIR/$VSIX ($(du -h "$EXT_DIR/$VSIX" | cut -f1))"
echo
echo "Install locally:"
echo "  code --install-extension $EXT_DIR/$VSIX"
