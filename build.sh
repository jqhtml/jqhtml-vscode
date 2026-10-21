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
# jqhtml-vscode-extension - which is the name every published .vsix has carried. The
# staging copy also drops "files" (which governs the npm tarball only): vsce refuses
# to run when both "files" and a .vscodeignore are present, and .vscodeignore is what
# governs the .vsix.
#
# After packaging, the .vsix is unzipped and the build FAILS if it contains a
# sourcemap or any development tree - see the post-package check at the bottom.
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
# Toolchain. tsc lives at the monorepo root. vsce is taken from the root
# node_modules when vendored there, else from PATH; when neither has it, the
# packaging step installs the latest @vscode/vsce globally from public npm (never
# into the tracked node_modules tree, never through npx).
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

# ---------------------------------------------------------------------------
# Bundle @jqhtml/parser into out/vendor/jqhtml-parser.js. Diagnostics compile
# templates with it (src/diagnostics.ts imports ./vendor/jqhtml-parser). The
# parser is ESM and depends on source-map, while the extension is CommonJS and
# ships no node_modules, so esbuild inlines both into one CommonJS file. The
# source is the parser's built dist/ in this monorepo - build the parser first
# when its src/ has changed. Nothing is downloaded.
# ---------------------------------------------------------------------------
PARSER_ENTRY="$REPO_ROOT/packages/parser/dist/index.js"
if [ -x "$REPO_ROOT/node_modules/.bin/esbuild" ]; then
  ESBUILD="$REPO_ROOT/node_modules/.bin/esbuild"
elif command -v esbuild >/dev/null 2>&1; then
  ESBUILD=esbuild
else
  echo "ERROR: esbuild not found (looked for $REPO_ROOT/node_modules/.bin/esbuild, then PATH)." >&2
  exit 1
fi
[ -f "$PARSER_ENTRY" ] || { echo "ERROR: $PARSER_ENTRY is missing - build packages/parser first" >&2; exit 1; }

echo "--- Bundling @jqhtml/parser $(node -p "require('$REPO_ROOT/packages/parser/package.json').version") -> out/vendor/jqhtml-parser.js"
"$ESBUILD" "$PARSER_ENTRY" --bundle --platform=node --format=cjs --target=node16 \
  --legal-comments=inline --log-level=warning --outfile=out/vendor/jqhtml-parser.js
node -e 'const p = require(process.argv[1]); if (typeof p.compileTemplate !== "function") { process.exit(1); }' \
  "$EXT_DIR/out/vendor/jqhtml-parser.js" \
  || { echo "ERROR: out/vendor/jqhtml-parser.js does not export compileTemplate" >&2; exit 1; }

# The compiler's JavaScript scanner, for the formatter and the typing helpers: they
# find the %> closing a <% %> block with the same rules as the compiler (strings,
# regexes and comments hide %>; a // comment runs to the end of its line).
"$ESBUILD" "$REPO_ROOT/packages/parser/dist/js_scanner.js" --bundle --platform=node --format=cjs \
  --target=node16 --legal-comments=inline --log-level=warning --outfile=out/vendor/jqhtml-js-scanner.js
node -e 'const s = require(process.argv[1]); if (typeof s.find_template_close !== "function") { process.exit(1); }' \
  "$EXT_DIR/out/vendor/jqhtml-js-scanner.js" \
  || { echo "ERROR: out/vendor/jqhtml-js-scanner.js does not export find_template_close" >&2; exit 1; }

if [ "$MODE" = release ]; then
  # A release must ship no debug residue. Fail loudly rather than shipping it.
  # A sourcemap comment is a line that starts with //# sourceMappingURL=; the
  # bundled parser writes that text into the code it generates, mid-line.
  if compgen -G "out/**/*.js.map" >/dev/null || compgen -G "out/*.js.map" >/dev/null \
      || grep -rqlE '^//[#@] sourceMappingURL=' out; then
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
# This packaging step was written against vsce 4.0.0. Newer releases are welcome
# (the latest is installed when vsce is missing), but if packaging or the checks
# below fail under another version, say so: the cause may be a vsce change.
VSCE_WRITTEN_FOR="4.0.0"

if [ -x "$REPO_ROOT/node_modules/.bin/vsce" ]; then
  VSCE="$REPO_ROOT/node_modules/.bin/vsce"
elif command -v vsce >/dev/null 2>&1; then
  VSCE=vsce
else
  echo "--- vsce not found; installing the latest @vscode/vsce globally"
  if ! npm install -g @vscode/vsce@latest --registry https://registry.npmjs.org/; then
    echo "ERROR: installing @vscode/vsce failed (see the npm output above)." >&2
    echo "       Install it by hand (npm install -g @vscode/vsce), or run" >&2
    echo "       ./build.sh --no-package to compile without packaging." >&2
    exit 1
  fi
  hash -r
  command -v vsce >/dev/null 2>&1 || {
    echo "ERROR: @vscode/vsce installed but no vsce on PATH (npm global bin: $(npm prefix -g)/bin)." >&2
    exit 1
  }
  VSCE=vsce
fi
VSCE_VERSION="$($VSCE --version 2>/dev/null || echo unknown)"
echo "  vsce: $VSCE ($VSCE_VERSION)"

STAGE="$(mktemp -d)"
on_exit() {
  local status=$?
  rm -rf "$STAGE"
  if [ "$status" -ne 0 ]; then
    echo "ERROR: packaging the .vsix failed (exit $status)." >&2
    if [ "$VSCE_VERSION" != "$VSCE_WRITTEN_FOR" ]; then
      echo "       This may be due to a new vsce version: this script was written for" >&2
      echo "       vsce $VSCE_WRITTEN_FOR and the installed version is $VSCE_VERSION. Review the" >&2
      echo "       latest vsce changes (https://github.com/microsoft/vscode-vsce/releases)" >&2
      echo "       to decide whether this script needs updating, or whether another" >&2
      echo "       failure reason is responsible." >&2
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

tar --exclude=node_modules --exclude='*.vsix' --exclude=.vscode-test -cf - . \
  | (cd "$STAGE" && tar -xf -)

node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  p.name = process.argv[2];
  // vsce refuses to run when package.json has "files" AND a .vscodeignore exists.
  // "files" governs the npm tarball and stays in the real manifest; .vscodeignore
  // governs the .vsix, so the staging copy drops "files" and lets .vscodeignore win.
  delete p.files;
  fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n");
' "$STAGE/package.json" "$PKG_NAME"

echo "--- Packaging $VSIX"
(cd "$STAGE" && $VSCE package --no-dependencies --allow-missing-repository >/dev/null)
[ -f "$STAGE/$VSIX" ] || { echo "ERROR: vsce reported success but produced no $VSIX" >&2; exit 1; }

rm -f "$EXT_DIR"/*.vsix
mv "$STAGE/$VSIX" "$EXT_DIR/$VSIX"

# ---------------------------------------------------------------------------
# Post-package check. .vscodeignore is the thing that keeps debug residue and
# development trees out of the .vsix, and a silent typo there is invisible until
# someone unzips a shipped build - so assert the result rather than trust it.
# ---------------------------------------------------------------------------
echo "--- Inspecting $VSIX"
VSIX_LIST="$(unzip -Z1 "$EXT_DIR/$VSIX")"
VSIX_COUNT="$(printf '%s\n' "$VSIX_LIST" | grep -c .)"

BAD="$(printf '%s\n' "$VSIX_LIST" | grep -E '(\.map$|(^|/)src/|(^|/)tools/|(^|/)test-files/|(^|/)\.vscode-test/|(^|/)build\.sh$)' || true)"
if [ -n "$BAD" ]; then
  echo "ERROR: $VSIX contains files that must not ship:" >&2
  printf '  %s\n' $BAD >&2
  echo "       Fix .vscodeignore (and package.json \"files\") rather than the check." >&2
  exit 1
fi
echo "  + $VSIX_COUNT files, no sourcemaps, no src/ tools/ test-files/ .vscode-test/ build.sh"

echo
echo "=== Build complete ==="
echo "  $EXT_DIR/$VSIX ($(du -h "$EXT_DIR/$VSIX" | cut -f1))"
echo
echo "Install locally:"
echo "  code --install-extension $EXT_DIR/$VSIX"
