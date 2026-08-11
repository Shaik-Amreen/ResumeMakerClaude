#!/bin/bash
# After agent git commits, rewrite HEAD if Cursor appended a co-author trailer.
input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')

if [[ ! "$command" =~ git[[:space:]]+commit ]]; then
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

if ! git log -1 --format='%B' 2>/dev/null | grep -q '^Co-authored-by: Cursor <cursoragent@cursor.com>$'; then
  exit 0
fi

MSG_FILE=$(mktemp)
trap 'rm -f "$MSG_FILE"' EXIT
git log -1 --format='%B' | sed '/^Co-authored-by: Cursor <cursoragent@cursor.com>$/d' >"$MSG_FILE"
while [ -s "$MSG_FILE" ] && [ -z "$(tail -1 "$MSG_FILE" | tr -d '[:space:]')" ]; do
  sed -i '' '$d' "$MSG_FILE" 2>/dev/null || sed -i '$d' "$MSG_FILE"
done

TREE=$(git rev-parse HEAD^{tree})
if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  PARENT=$(git rev-parse HEAD^)
  NEW=$(git commit-tree "$TREE" -p "$PARENT" -F "$MSG_FILE")
else
  NEW=$(git commit-tree "$TREE" -F "$MSG_FILE")
fi
git reset --hard "$NEW" >/dev/null 2>&1

exit 0
