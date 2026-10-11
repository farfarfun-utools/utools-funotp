#!/bin/sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(dirname -- "$PLUGIN_DIR")
cd "$ROOT_DIR"

command -v node >/dev/null || { echo "error: Node.js is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "error: pnpm is required (corepack enable)" >&2; exit 1; }
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" || {
  echo "error: Node.js >= 20 is required" >&2
  exit 1
}

pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
node --check "$PLUGIN_DIR/preload.js"
node -e "JSON.parse(require('fs').readFileSync('$PLUGIN_DIR/plugin.json', 'utf8'))"
rm -rf -- "$PLUGIN_DIR/dist"
pnpm build

test -f "$PLUGIN_DIR/dist/index.html"
test -f "$PLUGIN_DIR/preload.js"
test -f "$PLUGIN_DIR/logo.png"
test -f "$PLUGIN_DIR/search.png"
test ! -e "$PLUGIN_DIR/.git" || { echo "error: utools/ 内不应存在 .git" >&2; exit 1; }

echo "uTools plugin ready: $PLUGIN_DIR/plugin.json"
