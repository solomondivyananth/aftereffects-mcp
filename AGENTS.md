# Working on this repo (for AI agents and people)

AE MCP Bridge: an MCP server (`mcp/ae-mcp.js`) → CEP panel (`panel/js/main.js`)
→ ExtendScript (`panel/jsx/bridge.jsx`, **ES3 only**) → After Effects. Skills in
`skills/` teach agents how to use it. Read `README.md` and
`skills/ae-mcp-bridge/SKILL.md` first.

More than one agent may be working in this folder at once. Before editing,
check `git status` and the ownership table below. Don't edit files another
agent owns; add a line to the table instead of taking one.

## Skills: who is writing what

| Skill | Owner | Status |
|---|---|---|
| ae-mcp-bridge | Claude | done |
| ae-motion-principles | Claude | done |
| ae-expressions | Claude | done, every expression verified in AE |
| ae-deliver | Claude | done |
| ae-effects | Claude | done |
| video-reference-compare | Claude | done (Node port, cross-platform) |
| ae-transitions | Claude | done, names and recipes verified in AE |
| ae-morph | Claude | done |
| ae-camera-3d | Claude | done, rig, lights, materials and focus expression verified in AE |
| ae-typography (text animators, per-character, kinetic type systems) | open | |
| ae-color (Lumetri, curves, LUTs, matching shots) | open | |
| ae-audio-sync (audio to keyframes, beat markers, cutting to music) | open | |
| ae-templates (Essential Graphics, MOGRT, controls for editors) | open | |
| ae-data-driven (charts and versions from CSV/JSON) | open | |

Claim an open row by writing your name in it before you start.

## Rules for a skill

- `skills/<name>/SKILL.md`, frontmatter `name` equal to the folder name, and a
  `description` that says what it does **and when to use it** (under 1024
  characters). Scripts go in `skills/<name>/scripts/` and must run on macOS
  and Windows (Node, not bash).
- Only real tool names. `npm test` fails on any `ae_*` name that isn't a tool.
- **Effect and parameter names must be verified in a live After Effects**, or
  left out. List effects with `ae_catalog {"kind": "effects", "query": "…"}`.
  Get parameter names by applying the effect to a layer in a scratch project
  (`ae_apply_effect` returns them). Names differ between versions and
  installs, so never guess.
- **Expressions must compile.** Apply each one with `ae_set_expression` in a
  scratch comp; it's rejected with the error if it doesn't. Then check
  `ae_find_animation` for an `expressionError` at a few times.
- Test only in a throwaway project whose path contains `test`
  (e.g. `~/.ae-mcp-bridge/test/bridge-test.aep`). Never write to a user's
  real project.
- Nothing client- or project-specific. Examples use neutral names ("Logo",
  "Title", "Master 16x9").
- Things After Effects can't do from a script (tracking, the 3D camera
  tracker, Roto Brush, Content-Aware Fill, puppet pins) are stated plainly,
  with the manual step for the user.

## Code rules

- `bridge.jsx` is ES3: `var` only, no `let`/`const`/arrow functions/template
  strings, no `Array.prototype.indexOf/forEach/map`. `npm test` checks this.
- Every write tool is one undo step. Read-only tools must leave Edit ▸ Undo
  untouched (don't change comp settings to render, for example).
- Never look a layer up again by name or index after an edit: edits rename
  and reorder. Keep the layer object.
- `npm test` must pass (it runs in CI on macOS and Windows).
  `npm run test:live` runs against a real After Effects.

## Commits

Commit as the repo owner: `git -c user.name="Solomon Divyananth"
-c user.email="solomondivyananth@gmail.com" commit …`. **No `Co-Authored-By`
or other AI attribution lines.** Don't push unless the owner asks.
