---
name: ae-deliver
description: Get an After Effects piece out the door through the AE MCP Bridge - a pre-flight check (missing footage, broken expressions, stray solo and guide layers, text overflow, work area), format variants with safe areas for 16x9, 9x16, 1x1 and 4x5, render templates, background renders and Media Encoder, and verifying the file that comes out. Use when asked to render, export, deliver, make versions or cutdowns for other platforms, or check that a comp is ready to hand off.
---

# Deliver

A render is the one step a person sees the result of. Check before it,
render deliberately, and check the file after it.

## 1. Pre-flight

Run these reads before any final render and report what you find. Don't
fix silently.

| Check | How |
|---|---|
| Missing footage | `ae_item_action {"action": "missing"}` |
| Broken expressions | `ae_find_animation` on the comp: any `expressionError` |
| Solo, shy or disabled layers left on by accident | `ae_comp_tree`: `solo: true`, `enabled: false` on layers that should show |
| Guide layers | `ae_comp_tree` → `ae_layer_detail`. Guide layers don't render, so make sure nothing needed is one |
| Work area | `ae_selection` gives `workArea`. Renders use the work area unless start and end are set |
| Frame rate and size | `ae_project_info`: every comp in the chain at the delivery rate |
| Text overflow and typos | `ae_render_frame` at each text beat, and read the words back with `ae_text` |
| Last frame | `ae_render_frame` at the final frame: nothing cut off, nothing popping |

Save first (`ae_save_project`). Background renders read the project file on
disk, not the open app.

## 2. Format variants

Make variants from the finished master, never by rebuilding:

```json
ae_duplicate_comp {"comp": "Master 16x9", "name": "Master 9x16", "width": 1080, "height": 1920}
```

That re-centres top-level layers. Then reposition anything near an edge and
check every variant with `ae_render_frame`.

| Format | Size | Keep key content inside |
|---|---|---|
| 16:9 broadcast and web | 1920×1080 | title-safe 90% (1728×972), action-safe 93% |
| 9:16 Reels, TikTok, Shorts | 1080×1920 | about 1080×1420, clear of the top ~220 px and bottom ~380 px of platform UI |
| 1:1 feed | 1080×1080 | ~5% margin |
| 4:5 feed | 1080×1350 | ~5% margin, bottom caption area |

Platform UIs change. Treat those numbers as a start, and make the safe area
visible while working. A guide layer doesn't render:

```json
ae_shape {"comp": "Master 9x16", "name": "SAFE", "shape": "rect", "size": [1080, 1420],
          "stroke": {"color": "#ff3b30", "width": 4}}
ae_set_layer_props {"comp": "Master 9x16", "layer": "SAFE", "props": {"guideLayer": true, "locked": true}}
```

## 3. Render

Look up what this machine actually has. Template names differ between
installs and versions:

```json
ae_catalog {"kind": "render_templates"}
ae_catalog {"kind": "output_templates"}
```

| Deliverable | Route |
|---|---|
| Master or archive | `ae_render_video` with a ProRes or lossless output-module template from the catalog |
| Web or social H.264 | an H.264 output template if the catalog lists one (After Effects 2023+ has native H.264), otherwise `ae_render_queue {"action": "add", …}` then `{"action": "queue_in_ame"}` for Media Encoder |
| Quick review | `ae_render_video` with `startFrame`/`endFrame` over just the part in question |
| Frames for a thumbnail | `ae_render_frame {"time": …, "downscale": 1}` |

`ae_render_video` renders in the background and After Effects stays usable.
Poll `ae_render_status` every 10–30 seconds (not in a tight loop) until
`status` is `done` or `failed`. The log tail says why a render failed. Use
`ae_render_cancel` to stop one. Renders survive a reload of the panel.

Name outputs so they sort and say what they are:
`Project_Variant_1080x1920_30fps_v003.mp4`.

## 4. Verify the file

The render finishing isn't the same as the render being right.

- `ae_render_status` reports `outputExists` and `outputBytes`: zero or
  missing means it failed.
- Check duration, frame rate and size with ffprobe:
  `ffprobe -v error -show_entries stream=width,height,r_frame_rate:format=duration -of json out.mp4`
- If there's an approved reference or a previous version, compare them frame
  by frame with the `video-reference-compare` skill, especially at cuts and
  text beats.
- Say what was checked and what wasn't. A contact sheet isn't playback, so
  recommend a real-time watch before it ships.

## Hand-off

- `ae_item_action {"action": "reduce", "items": ["Master 16x9", …]}` trims
  the project to what the deliverables use. Save it under a new name first:
  `ae_save_project {"path": …}`.
- Collect Files (File ▸ Dependencies ▸ Collect Files) isn't scriptable. Ask
  the user to run it if the project has to travel with its footage.
