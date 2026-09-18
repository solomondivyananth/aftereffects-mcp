#!/usr/bin/env bash
# Push local panel changes into a --copy install (on Windows: install.cmd --copy).
# Not needed for a linked install. Afterwards click ↻ in the panel.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$HERE/bin/install-panel.js"
