---
name: ae-mcp-bridge
description: Work inside a live Adobe After Effects project through the AE MCP Bridge (the ae_* tools) - read comps and animation, render frames to look at, animate and edit keyframes, expressions, effects, presets, text, masks, shapes and markers, build comps and format variants, and render. Use whenever a task touches the After Effects project that is open right now, or when an ae_* call is refused or fails.
---

# AE MCP Bridge

The `ae_*` tools work inside the After Effects the user has open, through a
CEP panel (Window ▸ Extensions ▸ AE MCP Bridge). Everything is live: reads
show the real project, and writes change it the way a hand edit would — each
call is one step in Edit ▸ Undo, labelled "MCP: …", and (unless the user
switched it off) the comp opens, the touched layers are selected and the
playhead moves to the edit, so the user watches the work happen.

```
ae_* tool ──stdio──► mcp/ae-mcp.js ──HTTP 127.0.0.1:7788──► panel ──evalScript──► AE
```

## Work like an animator

Never edit blind. Every job is **read → edit → look**.

1. **Orient** — `ae_project_info`. If the user says "this", "these keys",
   "here", call `ae_selection`: it has the selected layers, properties,
   keyframes and the playhead.
2. **Read** — `ae_comp_tree` for the stack, then `ae_layer_detail` (with
   `path` to stay small) for keyframes, eases and expressions.
3. **Edit** — the most specific tool (tables below). Many layers? Pass
   `layers` — one call, one undo step.
4. **Look** — `ae_render_frame` at what you changed; `ae_review_motion` after
   anything that moves. Report what you *saw*, not what you intended.
5. **Show** — `ae_goto` parks the user's viewer on the moment you mean.

Made a mistake? `ae_undo`. It walks Edit ▸ Undo, so it also undoes the user's
own hand edits if they came after yours — check `ae_selection` first if they
might have been working.

## Reading traps

- **Transform is not where animation lives.** Text animators, trim paths,
  masks and effects animate on their own. Trust `animatedProperties` /
  `isAnimated`, or `ae_find_animation`, before calling a layer static.
- **A still can't show motion.** A frame mid-reveal looks like a hard cut.
  Judge timing with `ae_review_motion`, never one frame.
- `ae_find_animation` and `ae_layer_detail` flag broken expressions
  (`expressionError`) — check them when something renders wrong.

## Addressing

| | Form |
|---|---|
| comp | name or id; omit for the comp in the timeline |
| layer | name or **1-based** index; omit for the single selected layer |
| layers | `["Title", 3]`, `"selected"`, `"all"`, or `{match: "^BG"}` |
| property path | `["Transform","Position"]`, `["Effects","Glow","Glow Radius"]`, `["Masks","Mask 1","Mask Path"]`, `["Contents","Group 1","Transform","Rotation"]`, `["Text","Source Text"]` |
| time | seconds `2.5`, frames `"75f"`, or timecode `"0:00:02:15"` |
| colour | `"#ff8800"`, `[1,0.53,0]` or `[255,136,0]` |
| path/mask shape | `{vertices, inTangents, outTangents, closed}` |

A wrong path segment returns the valid children at that level — read it and
retry; don't guess twice. Unsure of an effect, preset, font or render template
name? `ae_catalog` looks it up.

## Which tool

| Want | Tool |
|---|---|
| static value / one keyframe | `ae_set_property` (with `time` for a key) — returns before/after |
| a run of keys | `ae_add_keyframes` — `ease` `"easy"` (F9), `"easy_in"`, `"easy_out"`, 0.1–100, or `{in,out}`; `interp`; `spatial` handles |
| change existing keys | `ae_edit_keyframes` — pick `"selected"`, indices, times, `{from,to}`; delete, `shift`, `moveTo`, `scaleTime`, `value`, `offset`, ease, interp, `copyTo` another layer |
| procedural motion | `ae_set_expression` — validated; errors come back, nothing left broken |
| effect | `ae_apply_effect` (returns all parameters) |
| animation preset | `ae_apply_preset` by name ("Typewriter") or .ffx path |
| text content & style | `ae_text` — font (PostScript name), size, colours, stroke, tracking, leading, justification, per-character `ranges` |
| markers | `ae_markers` — comp (no layer) or layer; comments, durations, chapters, cue points |
| masks | `ae_masks` — `{rect}`, `{ellipse}` or vertices; mode, feather, expansion |
| shapes | `ae_shape` — rect/ellipse/star/polygon/path + fill, stroke, trim, repeater in one call |
| text animators, anything addable | `ae_add_property` (e.g. `add:"ADBE Text Animator", animate:["ADBE Text Opacity"]` under `["Text","Animators"]`) |
| remove / rename / reorder / duplicate / fx switch | `ae_remove_property`, `ae_property_meta` |
| layer switches, blend mode, track matte, parent, timing | `ae_set_layer_props` — returns before/after |
| duplicate, split, sequence, freeze, align, fit, centre anchor | `ae_layer_action` |
| many edits as one undo step | `ae_batch` — atomic: a failure rolls the rest back |
| a menu command no tool covers | `ae_menu_command` ("Convert to Editable Text", "Drop Shadow", "Convert Audio to Keyframes") |
| anything else | `ae_run_jsx` — ES3 ExtendScript: `var` only, no `let`/`const`/arrows/template strings |

## Building and delivering

- `ae_create_comp` → `ae_create_layer` / `ae_import_file` (then kind
  `footage`) / `ae_shape` → animate → look.
- **Format variants:** `ae_duplicate_comp` with `width`/`height` re-centres
  top-level layers; then check each with `ae_render_frame` — safe areas differ.
- Project housekeeping — folders, replace footage, proxies, interpret
  footage, missing files, reduce project — is `ae_item_action`.
- **Render:** `ae_render_video` runs `aerender` in the background (saves the
  project first); poll `ae_render_status`, stop with `ae_render_cancel`. Jobs
  survive a panel reload. `ae_render_queue` drives the Render Queue panel and
  Media Encoder (`queue_in_ame`); its `render` action blocks the app.

## When a write is refused

The **sandbox guard** (on by default) only allows writes to the project the
user marked as the sandbox. **Only the user can change that, in the panel.**
There is no tool for it — don't try to route around it; tell them:

| Refusal says | Ask the user to |
|---|---|
| no sandbox project is set | open the project, click **Use current project as sandbox** |
| open project has never been saved | save it, then set it as the sandbox |
| open project is not the sandbox | set this one as the sandbox, or switch projects |
| `new_project` / `open_project` closes the open project | untick **Guard writes to sandbox only** |
| raw scripting is switched off | tick **Allow raw ExtendScript and menu commands**, or use a dedicated tool |

Reads, renders, `ae_goto` and `ae_catalog` always work.

`ae_new_project` / `ae_open_project` refuse unless you say what happens to
unsaved work: `saveFirst` (true or a path) or `discardUnsavedChanges: true`.
Never discard without the user saying so.

## When the bridge doesn't answer

| Symptom | Fix |
|---|---|
| `Cannot read ~/.ae-mcp-bridge.json` / no token | open Window ▸ Extensions ▸ AE MCP Bridge once |
| connection refused | panel closed or AE not running — the panel must show `Listening on 127.0.0.1:7788` |
| token error | panel restarted; retry (the token is re-read every call) |
| call hangs, then times out | a modal dialog is open in AE — ask the user to dismiss it |
| new tools missing / "Unknown bridge function" | the panel is running old code — click ↻ in the panel |
| panel missing from the menu | run the installer (`npx aftereffects-mcp-install`, or `install.sh` / `install.cmd` from source), then **relaunch** AE |
| no contact sheet | `ffmpeg` isn't installed; frames come back individually |

## Taste stays with the user

The bridge can match an ease, measure a collision and apply one change across
fifty layers. It can't tell whether the piece is good. When a change is a
creative call rather than a mechanical one, show a frame and ask.
