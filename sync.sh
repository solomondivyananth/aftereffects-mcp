#!/usr/bin/env bash
# Push local panel changes into an installed --copy of the extension.
# Not needed for a symlink install. After running this, click the reload
# button in the panel (or reopen it) to pick the changes up.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/com.aemcpbridge"

if [ -L "$TARGET" ]; then
  echo "Symlink install — nothing to sync."
  exit 0
fi
if [ ! -d "$TARGET" ]; then
  echo "Not installed. Run ./install.sh first." >&2
  exit 1
fi

rsync -a --delete --exclude '._*' --exclude '.DS_Store' "$HERE/panel/" "$TARGET/"
echo "Synced to $TARGET — click the reload button in the panel."
