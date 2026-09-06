# AE Claude Bridge

Claude Code reads, views and edits an open After Effects project in real time.

```
Claude Code ──stdio──► mcp/ae-mcp.js ──HTTP :7788──► CEP panel in AE ──evalScript──► AE DOM
```

- **Read** — project structure, layer stacks, every property, keyframe and expression.
- **View** — `saveFrameToPng` renders frames that come back to Claude as images.
- **Edit** — properties, keyframes, expressions, effects, layers. Every call is one
  `beginUndoGroup`, so anything Claude does is a single ⌘Z.

## Requirements

- After Effects 2022 (22.0) or newer — CEP 11/12 with ExtendScript
- Node.js 18+ (the MCP server has zero dependencies)
- macOS. Windows is not supported yet: the installer, `sips` downscaling and the
  CEP paths are macOS-specific, though the bridge and MCP server are portable.
- Optional: `ffmpeg` for `ae_review_motion` contact sheets and MP4s

## Security

The bridge can execute arbitrary ExtendScript inside After Effects. It binds
loopback only and requires a shared secret (generated on first run into
`~/.ae-claude-bridge.json`) on every request, refuses any request carrying an
`Origin`/`Referer` header, and requires `Content-Type: application/json`.
Read [SECURITY.md](SECURITY.md) before changing anything in the request path.

## Install

```bash
./install.sh              # symlink the panel, enable unsigned extensions
./install.sh --copy       # copy instead, if AE ignores the symlink
./install.sh --global     # also register the MCP server for every directory
```

Then **relaunch After Effects** (PlayerDebugMode is read at launch) and open
**Window ▸ Extensions ▸ Claude Bridge**. The panel should show a green dot and
`Listening on 127.0.0.1:7788`.

## The sandbox guard

Reads and renders always work on whatever project is open. **Writes are refused
unless the open project is the designated sandbox.** Only you can change that,
from the panel — there is no tool that lifts the guard:

- *Use current project as sandbox* — pins writes to the project you have open.
- *Guard writes to sandbox only* — uncheck to let Claude edit any open project.

Settings live in `~/.ae-claude-bridge.json`.

## Tools

| Tool | |
|---|---|
| `ae_project_info` | comps, sizes, frame rates, active comp — start here |
| `ae_comp_tree` | layer stack with transforms, timing, parenting, effects |
| `ae_layer_detail` | full property tree: values, keyframes, expressions |
| `ae_selection` | what the user has selected right now |
| `ae_render_frame` | render frames to PNG and look at them |
| `ae_set_property` | set a value, static or keyframed |
| `ae_add_keyframes` | write a run of keys with easing |
| `ae_set_expression` / `ae_clear_expression` | expressions, validated by AE |
| `ae_apply_effect` | apply an effect and set parameters |
| `ae_create_layer` / `ae_delete_layer` / `ae_set_layer_props` | layer management |
| `ae_run_jsx` | escape hatch: arbitrary ExtendScript |

Property paths are arrays: `["Transform","Position"]`,
`["Effects","Gaussian Blur","Blurriness"]`. Names or matchNames both work; a
wrong segment returns the list of valid children.

## Layout

```
panel/           CEP extension loaded by After Effects
  CSXS/manifest.xml
  index.html     status, sandbox controls, live call log
  js/main.js     HTTP server, evalScript dispatch, guard enforcement
  jsx/bridge.jsx everything that touches the AE DOM (ES3)
mcp/ae-mcp.js    MCP server — zero dependencies, stdio JSON-RPC
.mcp.json        registers the server for this project
```

## Notes and limits

- `bridge.jsx` is **ES3**. No `let`, `const`, arrow functions or native `JSON`
  (a polyfill is at the top of the file).
- Responses over 100 KB spill to a temp file and are read back by the panel —
  `evalScript`'s return channel can't carry them.
- After Effects is single-threaded: during a RAM preview, a foreground render or
  any modal dialog the bridge is unresponsive and calls time out at 120s.
- `ae_render_frame` downscales via the comp's resolution factor, then again with
  `sips` to fit `AE_BRIDGE_MAX_PX` (default 1024). Set `downscale: 1` for detail.
- **`saveFrameToPng` is asynchronous.** It returns ~450ms before the PNG is on
  disk, and the file appears at size 0 first. Both the panel and the MCP server
  poll each frame until it exists and has stopped growing — don't remove either
  guard, they cover different version-skew cases.
- Frames go to `~/.ae-claude-bridge/frames/`, not `Folder.temp`: AE's temp dir is
  a per-app sandbox that processes outside After Effects cannot read.
- `sips` scales beside the source file rather than through the OS temp dir, which
  is not writable in every context this server gets spawned in.
- Port is configurable in the panel; the MCP side reads `AE_BRIDGE_PORT`.

## Traps worth remembering

**`elided` does not mean "ignore".** In the AE DOM, `PropertyBase.elided` marks a
group that isn't drawn as its own row in the timeline — `Animators`, `Selectors`,
`Properties` on a text layer all have `elided === true`. Their children are real
and are frequently where the animation lives. `_walk` flattens elided groups
rather than skipping them; skipping them made a typewriter-animated text layer
report as "not animated", which produced a wrong edit to a real client project.

**Transform is not where animation lives.** A layer can be fully animated with an
empty Transform group: text animators, shape trim paths, mask paths and effect
parameters all animate independently. `comp_tree` returns `animatedProperties`
from a full-tree scan, and `ae_find_animation` does it on demand. Never conclude
"this layer isn't animated" from transform keyframe counts alone.

**Stills lie about motion.** A frame sampled mid-reveal is indistinguishable from
a hard cut. Use `ae_review_motion` before judging timing.

## Not built yet

- Change notifications — the panel polls the project every 3s for its own display
  but doesn't push events to Claude, so Claude re-reads on demand.
- Motion review is a contact sheet of stills; no video round-trip via `aerender`.
- Unsigned. Shipping to other machines needs ZXP signing.
