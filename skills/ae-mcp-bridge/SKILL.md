---
name: ae-mcp-bridge
description: Work inside a live Adobe After Effects project through the AE MCP Bridge (the ae_* tools) - read comps and animation, render frames to look at, edit keyframes, expressions, effects and layers, build comps and format variants, and render video. Use whenever a task touches the After Effects project that is open right now, or when an ae_* call is refused or fails.
---

# AE MCP Bridge

The `ae_*` tools talk to the After Effects the user has open, through a CEP
panel (Window ▸ Extensions ▸ AE MCP Bridge). Every call is live: reads show the
real project, writes change it, and each call is one undo step, so any single
edit is one ⌘Z.

```
ae_* tool ──stdio──► mcp/ae-mcp.js ──HTTP 127.0.0.1:7788──► panel ──evalScript──► AE
```

## The loop

Never edit blind. Every job is **read → edit → look**.

1. **Orient** — `ae_project_info`. Cheap. Gives every comp's size, duration,
   fps, the active comp and the playhead. If the user says "this layer" or
   "here", call `ae_selection` instead of guessing.
2. **Read** — `ae_comp_tree` for the layer stack, then `ae_layer_detail` (with
   `path` to stay small) for keyframes, eases and expressions.
3. **Edit** — the smallest tool that does the job (table below).
4. **Look** — `ae_render_frame` at the moments you changed. After anything that
   moves, `ae_review_motion` over the range. Then say what you saw, not what
   you intended.

## Reading traps

- **Transform is not where animation lives.** Text animators, shape trim
  paths, mask paths and effect parameters animate on their own. A layer with a
  static Transform can be fully animated. Trust `animatedProperties` /
  `isAnimated` from `ae_comp_tree`, or run `ae_find_animation`, before saying a
  layer "doesn't animate".
- **A still can't show motion.** A frame caught mid-reveal looks like a hard
  cut. Use `ae_review_motion` (or `ae_render_frame` with `frames`) to judge
  timing and easing, never one frame.
- `ae_layer_detail` hides untouched properties by default
  (`includeDefaults: false`). Absent does not mean missing.

## Addressing things

| | Form |
|---|---|
| comp | name; omit for the comp open in the timeline |
| layer | name or **1-based** index; omit for the single selected layer |
| property path | array: `["Transform","Position"]`, `["Effects","Gaussian Blur","Blurriness"]`, `["Text","Source Text"]` — display names or matchNames |
| time | **seconds**, never frames. Frame *n* at *fps* is `n / fps` |
| colour | `[r,g,b]` or `[r,g,b,a]`, channels **0–1**, not 0–255 |

A wrong path segment returns the list of valid children at that level — read
it and retry with the right name; don't guess twice.

## Which edit tool

| Want | Tool |
|---|---|
| one static value | `ae_set_property` (no `time`) — refuses if the property is already keyframed |
| one keyframe | `ae_set_property` with `time` |
| a run of keyframes with easing | `ae_add_keyframes` — `interp` `linear`/`hold`/`bezier`, `ease` 0.1–100 (75 = soft) or `{in,out}`; `replace: true` clears old keys first |
| procedural motion | `ae_set_expression` — AE validates it; a syntax error comes back and nothing is left attached |
| remove an expression | `ae_clear_expression` |
| an effect | `ae_apply_effect` — returns parameter names so the next call can set them |
| a layer | `ae_create_layer` — `solid`, `text`, `shape`, `null`, `adjustment`, `camera`, `light`, `precomp`, `footage` |
| rename, parent, trim, reorder, 3D | `ae_set_layer_props` |
| text content | `ae_set_property` on `["Text","Source Text"]` with a string or `{text,fontSize,font}` |

**Footage into a comp:** `ae_import_file`, then `ae_create_layer` with kind
`footage` and `options.source` set to the item name. A nested comp is the same
call with kind `precomp`.

**`ae_run_jsx`** is the escape hatch for markers, masks, shape contents, render
queue details — anything above doesn't cover. It is **ES3 ExtendScript**: `var`
only, no `let`/`const`/arrow functions/template strings, no native `JSON`. The
last expression is returned. Prefer a dedicated tool whenever one exists.

## Building and delivering

- `ae_create_comp` → `ae_create_layer` / `ae_import_file` → animate → look.
- **Format variants:** `ae_duplicate_comp` the finished master, then
  `ae_set_comp_settings` for the new width/height and reposition — check each
  variant with `ae_render_frame`; safe areas differ per aspect.
- `ae_precompose` to group; `ae_list_items` before referencing a source by name.
- **Render:** `ae_render_video` (`comp`, absolute `output`) starts a background
  `aerender` job and saves the project first, because `aerender` reads the .aep
  from disk. Poll `ae_render_status` with the returned `jobId` — don't block on
  it — and `ae_render_cancel` to stop.

## When a write is refused

The **sandbox guard** is on by default: writes only work on the one project
the user marked as the sandbox, and **only the user can change that, in the
panel**. There is no tool for it. Don't try to work around it with
`ae_run_jsx`; tell the user which of these to do:

| Refusal says | Ask the user to |
|---|---|
| no sandbox project is set | open the project, click **Use current project as sandbox** |
| open project has never been saved | save it, then set it as the sandbox |
| open project is not the sandbox | set this one as the sandbox, or switch projects |
| `new_project` / `open_project` closes the open project | untick **Guard writes to sandbox only** (these are always refused while the guard is on) |

Reads, `ae_render_frame` and `ae_review_motion` always work, guard or not.

`ae_new_project` and `ae_open_project` also refuse unless you state what
happens to unsaved work: `saveFirst` (true or a path) or
`discardUnsavedChanges: true`. Never pick discard without the user saying so.
Give `ae_new_project` a `savePath`, since renders need a file on disk.

## When the bridge doesn't answer

| Symptom | Cause / fix |
|---|---|
| `Cannot read ~/.ae-mcp-bridge.json` | panel has never run — open Window ▸ Extensions ▸ AE MCP Bridge |
| connection refused | panel is closed, or AE isn't running; the panel must show a green dot and `Listening on 127.0.0.1:7788` |
| 401 / token error | panel was restarted; the server re-reads the token each call, so just retry |
| call hangs | a modal dialog is open in AE — ask the user to dismiss it |
| panel missing from the Extensions menu | run `./install.sh` in the repo, then **relaunch** AE (unsigned-panel mode is read at launch) |
| no MP4 / contact sheet from `ae_review_motion` | `ffmpeg` isn't installed; frames come back individually instead |

## Taste stays with the user

The bridge can match an existing ease curve, measure a collision and apply one
change across fifty layers. It can't tell whether the piece is good. When the
change is a creative call and not a mechanical one, show a frame and ask.
