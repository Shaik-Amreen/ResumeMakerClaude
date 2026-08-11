#!/bin/sh
# Create a commit without IDE-injected Co-authored-by trailers.
# Usage: stage changes first, then:
#   scripts/git-commit-clean.sh -m "subject" -m "body line"
#   scripts/git-commit-clean.sh -F commit-message.txt
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MSG_FILE="$(mktemp)"
trap 'rm -f "$MSG_FILE"' EXIT

if [ "$1" = "-F" ] && [ -n "$2" ]; then
  sed '/^Co-authored-by: Cursor <cursoragent@cursor.com>$/d' "$2" >"$MSG_FILE"
elif [ "$1" = "-m" ]; then
  while [ "$1" = "-m" ]; do
    shift
    printf '%s\n' "$1" >>"$MSG_FILE"
    shift
  done
  sed -i '' '/^Co-authored-by: Cursor <cursoragent@cursor.com>$/d' "$MSG_FILE" 2>/dev/null \
    || sed -i '/^Co-authored-by: Cursor <cursoragent@cursor.com>$/d' "$MSG_FILE"
else
  echo "Usage: git-commit-clean.sh -m \"message\" | -F message-file" >&2
  exit 1
fi

# Trim trailing blank lines (portable)
while [ -s "$MSG_FILE" ] && [ -z "$(tail -1 "$MSG_FILE" | tr -d '[:space:]')" ]; do
  sed -i '' '$d' "$MSG_FILE" 2>/dev/null || sed -i '$d' "$MSG_FILE"
done

TREE=$(git write-tree)
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  PARENT=$(git rev-parse HEAD)
  NEW=$(git commit-tree "$TREE" -p "$PARENT" -F "$MSG_FILE")
else
  NEW=$(git commit-tree "$TREE" -F "$MSG_FILE")
fi
git reset --hard "$NEW" >/dev/null

echo "Created clean commit: $(git rev-parse --short HEAD)"
git log -1 --format='%B'
