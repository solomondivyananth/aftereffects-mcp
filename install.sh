#!/usr/bin/env bash
# Installs the Claude Bridge CEP panel into After Effects.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ID="com.aeclaudebridge"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$EXT_DIR/$EXT_ID"

echo "→ Enabling unsigned CEP extensions (PlayerDebugMode)"
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
done
killall cfprefsd 2>/dev/null || true

mkdir -p "$EXT_DIR"

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  echo "→ Removing previous install at $TARGET"
  rm -rf "$TARGET"
fi

if [ "${1:-}" = "--copy" ] || [ "${2:-}" = "--copy" ]; then
  echo "→ Copying panel to $TARGET"
  cp -R "$HERE/panel" "$TARGET"
else
  echo "→ Linking panel to $TARGET"
  ln -s "$HERE/panel" "$TARGET"
  echo "  (run with --copy instead if After Effects does not see the symlink)"
fi

# The project's .mcp.json already registers the server for this directory.
# Pass --global to make the After Effects tools available from any directory.
if [ "${1:-}" = "--global" ] || [ "${2:-}" = "--global" ]; then
  if command -v claude >/dev/null 2>&1; then
    echo "→ Registering the MCP server at user scope"
    claude mcp remove after-effects --scope user >/dev/null 2>&1 || true
    claude mcp add after-effects --scope user -- node "$HERE/mcp/ae-mcp.js"
  else
    echo "! 'claude' CLI not on PATH; skipping global registration"
  fi
else
  echo "→ MCP server registered for this project via .mcp.json"
  echo "  (re-run with --global to use the tools from any directory)"
fi

cat <<'DONE'

Installed.

Next:
  1. Quit and relaunch After Effects (PlayerDebugMode is read at launch).
  2. Window ▸ Extensions ▸ Claude Bridge — the panel should say
     "Listening on 127.0.0.1:7788".
  3. Open the project you want Claude to work on and click
     "Use current project as sandbox".
  4. Back in Claude Code, ask it to run ae_project_info.
DONE
