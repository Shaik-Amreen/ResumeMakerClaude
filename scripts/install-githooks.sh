#!/bin/sh
# Install repo githooks locally (does not change git config).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.git/hooks"
cp "$ROOT/.githooks/prepare-commit-msg" "$ROOT/.git/hooks/prepare-commit-msg"
chmod +x "$ROOT/.git/hooks/prepare-commit-msg"
echo "Installed prepare-commit-msg hook."
