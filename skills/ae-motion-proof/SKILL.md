---
name: ae-motion-proof
description: Proof-read motion in After Effects through the AE MCP Bridge - screen a comp with ae_proof for overlapping or clipped elements, jitter, flicker, one-frame pops, keyframes off the frame grid, linear easing, text too small or too brief to read, uneven staggers, missing motion blur on fast moves, broken expressions, a solo switch left on or an empty first frame, plus staging checks for a beat with no focal point, no scale hierarchy or an unused frame, then verify each finding on a rendered frame. Use before delivery or review, after building or editing an animation, or when asked to check, QC, proof, polish, "find what is wrong", fix overlaps or get rid of jitter.
---

# Proof-read the motion

Every animation has two kinds of problem. One kind is taste — this beat is
slow, that colour is wrong — and the only way to find it is to watch
(`ae_review_motion`). The other kind is mechanical: two words sitting on top
of each other, a keyframe half a frame off the grid, type nobody can read on
a phone, a solo switch left on. Those are findable by measurement, and this
is what `ae_proof` does.

It reads. It never edits. The playhead does not move, so it is safe on
someone else's open project.

## Run it

```json
ae_proof {"comp": "S1_HOOK"}
ae_proof {"comp": "S1_HOOK", "start": "0.5s", "duration": "1s", "samples": 120}
ae_proof {"comp": "Master", "severity": "warn"}
ae_proof {"comp": "S4_PHONE", "staging": true}
ae_proof {"action": "checks"}
```

- Default range is the work area, sampled at about 60 moments. It takes
  roughly a second.
- **Sample densely when hunting jitter or pops.** At 60 samples over 30
  seconds the gap between samples is half a second, and a one-frame pop hides
  in it. Narrow the range and raise `samples` until the report says it is
  sampling every 1–2 frames.
- Proof each scene comp, not only the master. A master usually holds
  precomps, and a fault inside one belongs to that comp.
- `severity` and `group` narrow a noisy report; `action: "checks"` lists
  every check with a one-line description.

## Read the findings

Each finding carries `check`, `severity`, `where` (layers), `when` (seconds
and frames), what is wrong and how to fix it. `look_at` collects the times
worth rendering.

| Severity | Means |
|---|---|
| `error` | Almost certainly wrong. Fix it or decide it is deliberate. |
| `warn` | Wrong unless there is a reason. Look at the frame. |
| `note` | Worth a glance: a taste call, or something that is only sometimes a fault. |

**Look before you fix.** The sampler measures boxes, not pixels. When a box
may be bigger than what shows — a precomp measured as its whole frame, a PNG
with transparent margins, text with animators that hide characters, a masked
layer — the finding says "measured generously" and drops a severity. Render
that moment (`ae_render_frame {"times": [...]}` from `look_at`) before
believing it, and before changing anything.

Then fix, and run `ae_proof` again. A clean report plus one watch-through is
the standard to hand work over at.

## What it screens

Forty-one checks in six groups. Thresholds scale with the frame, so they
hold for 1080p and for a 9:16 phone cut.

### Space and layout

| Check | Catches | Threshold |
|---|---|---|
| `overlap` | Two elements on top of each other while both are readable | ≥12% of the smaller box, held longer than 0.3s, both at rest |
| `collide` | Elements passing through each other mid-move | >50% at the worst frame |
| `clipped` | An element cut off by the frame edge at rest | >2% of its own size outside |
| `overshoot` | An ease that carries out of frame and settles back clean | any, while moving |
| `safe-area` | Outside title-safe, or under the platform UI in 9:16 | 90% safe; top 12% / bottom 20% |
| `edge-crowd` | Almost touching the frame edge, so it reads as an accident | inside 2.5% of the short side |
| `tangent` | Two elements stopping a few pixels apart | 2px to 6px (at 1080) |
| `text-overflow` | Text wider than the frame, or overflowing its own box | >94% of frame width |
| `text-small` | Type too small to read at delivery size | under 2.2% of the short side |
| `text-copy` | Double spaces, straight quotes, `...` instead of …, stray spaces | any |

### Staging and hierarchy

Composition, measured. These are notes, never errors — design has
exceptions — and they only run where judging composition is fair: a comp
with its own full-frame background. For a scene comp that gets its
background from a master, pass `{"staging": true}`. The craft behind them is
in `ae-composition`.

| Check | Catches | Threshold |
|---|---|---|
| `frame-unused` | small elements floating in a lot of nothing | >45% of the height empty above and below, with nothing over 25% of the frame |
| `no-focal-point` | nothing big enough to be the subject | largest element under 12% of frame area |
| `no-scale-contrast` | everything the same size, so nothing leads | largest within 2× of the median, with 3+ elements |
| `same-staging` | every beat composed identically | all resting compositions centred within 12% of the frame height |

Layers placed by a camera are measured flat for these, and the finding says
so when that happened.

### Jitter and chatter

| Check | Catches | Threshold |
|---|---|---|
| `jitter` | A property reversing direction again and again by a pixel or two | 4+ reversals under 3px (1.5° for rotation) |
| `flicker` | Something appearing and disappearing within a few frames | 3+ toggles in the range |
| `wiggle-jitter` | `wiggle()` fast enough to read as noise; one seed shared by several layers | frequency >8, or >4 with 4°+ on rotation |
| `sub-pixel` | A slow drift on fractional pixels — type and thin strokes shimmer | under 1px per frame, not on whole pixels |

### Timing and keyframes

| Check | Catches | Threshold |
|---|---|---|
| `off-grid` | Keyframes off whole frames, so the move stutters | >0.05 of a frame |
| `pop` | A value jumping with nothing to cover it | big change within 1.5 frames, motion blur off |
| `speed-break` | Incoming and outgoing speed mismatched at a keyframe | ratio >3, both non-zero |
| `linear` | Transform keyframes left on linear interpolation | a span of 5+ frames |
| `read-time` | Text on screen for less time than it takes to read | under chars ÷ 15 + 0.4s |
| `stagger-drift` | A cascade whose offsets are uneven | spread >1.2 frames |
| `crowded-beat` | Four or more things starting to move at once | within 3 frames |
| `dead-air` | A stretch where nothing moves at all | >1.5s, and nothing expression- or precomp-driven |
| `unseen-keys` | Keyframes outside the layer's in/out, or past the comp | any |
| `mid-move` | The range starting or ending in the middle of a move | any |
| `marker-drift` | Keyframes near a marker but not on it | 0.5 to 4 frames off |

### Motion physics

| Check | Catches | Threshold |
|---|---|---|
| `strobe` | Moving far enough per frame to strobe with motion blur off | >60% of its own width, or >22% of frame width, per frame |
| `blur-switch` | Layer motion blur on while the comp switch is off | any |
| `long-way` | A rotation taking the long way round | >180° between neighbouring keys |
| `shear` | A rotated parent with non-uniform scale shearing its children | rotation >0.5°, scale mismatch >1% |
| `upscaled` | Footage past 100%, or a precomp scaled up without Collapse Transformations | >105% / >110% |

### Render integrity

| Check | Catches |
|---|---|
| `expression-error` | A broken expression, or one switched off |
| `missing-footage` | Footage the project cannot find |
| `never-visible` | A layer with content that never shows in this range |
| `switch-left-on` | Solo, shy, an effects switch off, a disabled effect |
| `duplicate-name` | Two layers with the same name — expressions grab the first |
| `comp-settings` | Half resolution, a short work area, a precomp at another frame rate |
| `empty-frame` | The first or last frame of the range with nothing on it |

## What it cannot see

Say so rather than implying the piece is clean because the report is.

- **Anything the camera places.** 3D layers are measured flat, so with a
  camera in the comp the space rules skip them. The report names them.
- **Effects that hide or move pixels** — a Linear Wipe, a Transform effect, a
  displacement. The box is the layer's, not the effect's result.
- **Colour, contrast, banding, flashes.** Look at rendered frames for those
  (`ae-color`).
- **Audio sync.** That is `ae-audio-sync` plus listening.
- **Spelling, grammar and whether the words are true.** It only catches
  typographic nits. Read the copy back with `ae_text`.
- **Taste.** Timing, weight and whether anything is beautiful: watch it with
  `ae_review_motion`, against `ae-motion-principles`.

## Where the fixes live

| Finding | Where the craft is |
|---|---|
| `linear`, `speed-break`, `pop`, `crowded-beat`, `dead-air` | `ae-motion-principles` |
| `text-small`, `text-overflow`, `read-time`, `text-copy` | `ae-typography` |
| `overlap`, `clipped`, `safe-area`, `edge-crowd`, `tangent` | `ae-ai-templates` (layout rules), `ae-deliver` (safe areas) |
| `strobe`, `blur-switch`, `jitter`, `sub-pixel` | `ae-motion-principles`, `ae-expressions` (wiggle and seedRandom) |
| `shear`, anything 3D | `ae-camera-3d` |
| `missing-footage`, `switch-left-on`, `comp-settings` | `ae-deliver` pre-flight |

## The loop

1. Build or edit.
2. `ae_proof` the comp you touched.
3. Render the `look_at` times and confirm each finding is real.
4. Fix what is real; say out loud what you decided was deliberate.
5. `ae_proof` again, then `ae_review_motion` once end to end.
6. Only then `ae-deliver`.

Run it on every format variant too — a layout that passes in 16:9 often
clips in 9:16.
