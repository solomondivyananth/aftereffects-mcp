---
name: ae-motion-principles
description: Motion-design craft for animating in After Effects through the AE MCP Bridge - timing in frames, easing that reads as intentional, overshoot and settle, stagger and overlap, arcs, and kinetic "stomp" typography, each as concrete ae_* tool calls. Use when asked to animate something, make motion "feel" better (snappier, smoother, punchier, more premium), fix timing notes, build kinetic type, or when an animation looks mechanical.
---

# Motion principles, as tool calls

Keyframes that hit the right values can still look wrong. This is the craft
layer on top of the `ae-mcp-bridge` skill: how long things take, how they
accelerate, and how several things move together. Every recipe here is
something you can actually call.

## Think in frames

Motion is judged in frames, not seconds. Read `frameRate` from
`ae_project_info` and pass times as frames (`"12f"`) so the numbers mean what
the eye sees. At 30 fps:

| Moment | Frames | Notes |
|---|---|---|
| a hit, a stomp, a cut-on-beat | 2–4 | anything shorter than 2 frames reads as a glitch |
| a small UI move, a pop | 6–10 | |
| a standard move across the frame | 12–18 | |
| a big, heavy or premium move | 20–30 | weight comes from duration and ease together |
| settle after an overshoot | 6–12 | |
| a hold long enough to read text | ~ words ÷ 3 × 30 frames, and at least 24 | viewers read about 3 words a second |

At 24 or 25 fps, keep the same *seconds*: scale the frame counts.

## Easing that reads

For a move from key A to key B, **A's out-influence** sets how it leaves and
**B's in-influence** sets how it lands. Pass them per key with
`ae_add_keyframes` or change them later with `ae_edit_keyframes`:

| Feel | Key A `ease` | Key B `ease` |
|---|---|---|
| even, mechanical (almost never right) | `interp: "linear"` | `interp: "linear"` |
| gentle, default | `"easy"` | `"easy"` |
| snappy arrival: fast start, soft landing | `{out: 15}` | `{in: 85}` |
| heavy, premium | `{out: 60}` | `{in: 90}` |
| launch: slow start, leaves fast | `{out: 85}` | `{in: 15}` |
| a hard stop, a slam | `{out: 10}` | `interp: "linear"` on arrival, then an overshoot key |

`"easy"` is 33% (F9 Easy Ease). Most "make it feel better" notes come down to
raising the landing influence to 75–90 and shortening the move.

```json
ae_add_keyframes {"layer": "Card", "path": ["Transform","Position"], "keys": [
  {"time": "0f",  "value": [960, 1300], "ease": {"out": 15}},
  {"time": "14f", "value": [960, 540],  "ease": {"in": 85}}]}
```

## Overshoot and settle

Things with mass overshoot and come back. With keys: go past the target, then
settle.

```json
ae_add_keyframes {"layer": "Logo", "path": ["Transform","Scale"], "keys": [
  {"time": "0f",  "value": [0, 0],     "ease": {"out": 20}},
  {"time": "8f",  "value": [108, 108], "ease": "easy"},
  {"time": "14f", "value": [97, 97],   "ease": "easy"},
  {"time": "19f", "value": [100, 100], "ease": {"in": 80}}]}
```

For springy motion that reacts to *any* keyed move, use an inertial-bounce
expression instead (see the `ae-expressions` skill).

## Stagger and overlap

Nothing in a group should start on the same frame. Offset each element by
2–4 frames. Keep a group's total stagger under about 12 frames or the last
item feels late.

- **Same animation, many layers:** key the first layer, then
  `ae_edit_keyframes {"copyTo": {"layer": …, "offset": "3f"}}` for each of the
  others. Put them all in one `ae_batch` so it's a single undo step.
- **Layers entering one after another:** `ae_layer_action {"action":
  "sequence", "layers": [...], "overlap": "20f"}`.
- **Overlapping action:** parts of one object stop at different times.
  Settle the secondary parts (a label, a shadow) 2–4 frames after the main
  body.

## Arcs and anticipation

- Natural moves travel on arcs. For Position keys use `"spatial": "auto"` (or
  `"continuous"`) so the motion path curves. Use `"linear"` only for machines.
- **Anticipation:** a small move the other way first (2–6 frames, 5–10% of
  the distance) makes the real move read as intentional.

## Kinetic "stomp" type

The look: one word at a time slams onto the screen on the beat.

1. **Beats first.** Put a comp marker on each beat with `ae_markers`
   (`action: "add"`). Everything is timed to markers, not guessed.
2. **One text layer per word**, big and heavy (`ae_create_layer` kind
   `text` with `style: {font, fontSize}`; find fonts with
   `ae_catalog {kind: "fonts"}`). Trim each layer to its beat with
   `ae_set_layer_props {inPoint, outPoint}`, or build one word and
   `ae_layer_action` duplicate/split.
3. **The slam:** Scale 300% → 92% in 3 frames, then → 100% in 3 more
   (`ease {out: 10}` then `"easy"`). Turn on motion blur for the layer
   (`motionBlur: true`) and for the comp (`ae_set_comp_settings
   {motionBlur: true}`).
4. **Impact:** a camera shake that decays after each marker. That's a
   marker-driven expression on a null the words are parented to (see
   `ae-expressions`). Add a white solid on 1–2-frame hold keys for flash
   frames on the big hits.
5. **Contrast:** alternate backgrounds (dark / light / accent) every few
   beats. Put small mono sub-captions under the claims that need proof.

## Always look

Values tell you nothing about feel. After every motion change:

- `ae_review_motion` over the move, with `frames` of about 2 per frame of
  animation, up to 48. Check that the landing decelerates, and that nothing
  arrives on the same frame as something else unless it's meant to.
- If there's a reference, compare frame by frame with the
  `video-reference-compare` skill.
- Say what you *saw* ("it lands on frame 14 and settles by 19"), not what you
  keyed.

Feel is subjective. When a choice is creative (how snappy, how much
overshoot), show a frame or the motion sheet and ask before applying it across
fifty layers.
