#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$ROOT_DIR/.tools/node/bin/node"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node runtime not found at: $NODE_BIN"
  echo "Install portable Node in .tools/node first."
  exit 1
fi

echo "Running syntax checks..."
"$NODE_BIN" --check "$ROOT_DIR/main.js"
"$NODE_BIN" --check "$ROOT_DIR/sentence-parser.js"

echo "Running parser regression tests..."
"$NODE_BIN" "$ROOT_DIR/tests/parser-regression.js"

echo "All checks passed."
