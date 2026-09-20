---
name: ae-deliver
description: Get an After Effects piece out the door through the AE MCP Bridge - a pre-flight check (missing footage, broken expressions, stray solo and guide layers, text overflow, work area), format variants with safe areas for 16x9, 9x16, 1x1 and 4x5, render templates, background renders and Media Encoder, and verifying the file that comes out. Use when asked to render, export, deliver, make versions or cutdowns for other platforms, or check that a comp is ready to hand off.
---

# Deliver

A render is the one step a person sees the result of. Check before it,
render deliberately, and check the file after it.

## 1. Pre-flight

Start with `ae_proof {"comp": "…"}` on every comp you are delivering: it
screens 37 mechanical faults at once — overlaps, clipped edges, jitter, pops,
unreadable type, broken expressions, switches left on — and returns the times
to look at (`ae-motion-proof`). Then run these reads, and report what you
find. Don't fix silently.

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
disk, not the open app — an unsaved change is simply not in the render.

**Fonts.** A font that isn't installed is substituted silently and the render
is wrong with no error anywhere. If the project came from someone else, read
the fonts back (`ae_layer_detail` on each text layer, or `ae_text`) and check
each one against `ae_catalog {"kind": "fonts", "query": "…"}` before
rendering.

## 2. Format variants

Make variants from the finished master, never by rebuilding:

```json
ae_duplicate_comp {"comp": "Master 16x9", "name": "Master 9x16", "width": 1080, "height": 1920}
```

That re-centres top-level layers. Then reposition anything near an edge and
check every variant with `ae_render_frame` — and with `ae_proof`, which is
where a layout that passes in 16:9 shows up as `clipped`, `safe-area` or
`text-overflow` in 9:16 (`ae-motion-proof`).

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

A stock After Effects has five render-settings templates — **Best Settings**
(what final renders use), **Current Settings**, **Draft Settings**, **DV
Settings**, **Multi-Machine Settings** — and twelve output modules,
including **Lossless**, **Lossless with Alpha**, **High Quality**, **High
Quality with Alpha**, **Alpha Only**, **H.264 - Match Render Settings** at 5,
15 and 40 Mbps, **TIFF Sequence with Alpha**, **Photoshop** and **AIFF
48kHz**. A machine with extra codecs (ProRes, DNx) shows more. Never assume:
list them, then pass the exact string.

| Deliverable | Render settings | Output module |
|---|---|---|
| Master to archive or hand on | Best Settings | Lossless, or ProRes 422 HQ if the machine has it |
| Anything with transparency | Best Settings | Lossless with Alpha (RGB + Alpha, straight) |
| Social or web 1080p | Best Settings | H.264 – 15 Mbps; 40 Mbps if it is full of gradients or grain |
| 4K web | Best Settings | H.264 – 40 Mbps, or a ProRes master to compress elsewhere |
| A still for a thumbnail | — | `ae_render_frame {"downscale": 1}` |
| A quick look for a review | Draft Settings | H.264 – 5 Mbps, over `startFrame`/`endFrame` only |

Gradients, smoke and grain are what break a bitrate budget. If a 15 Mbps
H.264 shows banding in a sky or a soft background, go up a template rather
than re-grading.

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

## Sound, colour and levels

- **Audio has to be switched on.** A render can come out silent because the
  output module has audio off, or the comp's audio is muted. If the piece has
  sound, check the file's audio stream after rendering, not the timeline.
- **Loudness**: about −14 LUFS integrated for social platforms, −16 for
  anything spoken-word, with true peaks under −1 dBTP. After Effects does not
  measure this; hand it to a tool that does, or tell the user it was not
  checked.
- **Broadcast levels**: if it is going to television, `ADBE
  DigitalVideoLimiter` (Video Limiter) on an adjustment layer over the master
  keeps luma and chroma legal. Web does not need it and it costs contrast.
- **Colour**: render in the project's working space and keep it consistent
  across variants. A master that was graded in one space and delivered in
  another shifts, and the shift is easiest to see in skin and in brand
  colours — compare a frame from the render against `ae_render_frame` of the
  same time.

## 4. Verify the file

The render finishing isn't the same as the render being right.

- `ae_render_status` reports `outputExists` and `outputBytes`: zero or
  missing means it failed.
- Check duration, frame rate and size with ffprobe:
  `ffprobe -v error -show_entries stream=width,height,r_frame_rate:format=duration -of json out.mp4`
- If there's an approved reference or a previous version, compare them frame
  by frame with the `video-reference-compare` skill, especially at cuts and
  text beats.
- Watch the first and last second. Most render faults live there: a black
  frame at the head, a move still going at the tail, an audio click.
- Say what was checked and what wasn't. A contact sheet isn't playback, so
  recommend a real-time watch before it ships.

## When a render fails

| What you see | Usually means | Do |
|---|---|---|
| `status: failed` immediately | the project on disk is older than the app, or the comp name is wrong | save, then re-check the name with `ae_project_info` |
| Output exists but is 0 bytes | the output module could not open the file | check the folder exists and is writable; avoid network paths |
| "Output module failed" | the codec is missing on this machine | list `output_templates` again and pick one that is there |
| The render never starts | another render is already queued, or After Effects is showing a dialog | `ae_render_status`, then ask the user to look at the app |
| Fonts look wrong | substitution, silently | check the fonts, re-render |
| It is far slower than expected | motion blur, depth of field, particles, 32-bit colour | render a 2-second range first to measure before committing |
| Frame rate is not what you asked for | a nested comp at another rate, or the output module conforming | `ae_proof` reports the mismatch; fix the precomp, not the output |

## Several at once

For a set of variants, add them all to the Render Queue and start it once,
rather than rendering one, waiting, and rendering the next:

```json
ae_render_queue {"action": "add", "comp": "Master 16x9", "output": "…/Master_1920x1080_v003.mov"}
ae_render_queue {"action": "add", "comp": "Master 9x16", "output": "…/Master_1080x1920_v003.mp4"}
ae_render_queue {"action": "queue_in_ame"}
```

Media Encoder (`queue_in_ame`) is the right home for a batch, because it
renders while After Effects stays free. Its `render` action inside After
Effects blocks the whole app, so only use it when nobody is working.

## Hand-off

- `ae_item_action {"action": "reduce", "items": ["Master 16x9", …]}` trims
  the project to what the deliverables use. Save it under a new name first:
  `ae_save_project {"path": …}`.
- Collect Files (File ▸ Dependencies ▸ Collect Files) isn't scriptable. Ask
  the user to run it if the project has to travel with its footage.
- Hand over a list, not a folder: what each file is, its size and duration,
  what was checked, and anything you decided not to fix. A deliverable
  nobody can identify comes back as a question.
- Keep the version number in the file name and bump it on every render that
  leaves the machine. `_final` is not a version.
