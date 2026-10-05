---
name: ae-motion-principles
description: Motion-design craft for animating in After Effects through the AE MCP Bridge - timing in frames, easing that reads as intentional, how long a move should take for the distance it covers, overshoot and settle, stagger and overlap, arcs and anticipation, secondary motion, motion blur and shutter angle, the AE 2026 behaviour effects (Bounce, Oscillate, Pendulum, On Beat), pacing a sequence, kinetic "stomp" typography, and how to read a speed graph back as numbers. Use when asked to animate something, make motion "feel" better (snappier, smoother, punchier, more premium, less floaty), fix timing notes, build kinetic type, or when an animation looks mechanical.
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

At 24 or 25 fps, keep the same *seconds*: scale the frame counts. At 60 fps
double them — a 12-frame move at 30 is 24 frames at 60, not 12. Getting this
wrong is the commonest reason a piece feels twice as fast as the reference.

**Distance sets duration.** The same 14 frames that suit a card sliding 200 px
make a full-frame push feel slow, and make a tiny nudge feel sluggish. Start
from:

```
frames ≈ 6 + 16 × (distance ÷ frame width)
```

A 200 px move in a 1920 frame is ~8 frames; half the frame is ~14; edge to
edge is ~22. Then adjust for weight, not for taste alone: heavy things take
longer *and* land softer.

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

**Ease differs by property.** Position and Scale want a soft landing.
Opacity almost never wants one: a fade that eases in *and* out spends its
whole life half-visible, so fade with `{out: 20}` / `{in: 20}` or linear, and
make it shorter than the move it belongs to (6–10 frames against a 14-frame
slide). Rotation reads best with matched influence at both ends unless it is
a slam.

**Lead with opacity, land with position.** Start the fade 1–2 frames before
the move and finish it two thirds of the way through, so the element is
already readable when it arrives.

## Turning a note into a number

Directors' notes are all about the same four dials. This table is the fastest
route from what someone said to what to change:

| The note | What is actually wrong | Change |
|---|---|---|
| "floaty", "soft", "slow" | the landing is too gentle for the duration | shorten 25–35%, raise landing influence to 80–90 |
| "snappy", "too fast", "jarring" | no deceleration, or fewer than 6 frames | add 3–5 frames, landing influence 70–80 |
| "mechanical", "robotic" | linear interpolation, or everything identical | ease it; vary durations by 2–3 frames across the group |
| "cheap", "not premium" | short move, hard landing, no secondary motion | lengthen to 20–30 frames, `{out: 60}` / `{in: 90}`, stagger the parts |
| "busy", "chaotic" | too much at once | stagger 3–5 frames, or move the group as one object |
| "flat", "no energy" | no overshoot, no anticipation, no scale change | add a 5–8% overshoot and a 2–4 frame anticipation |
| "it pops" | a value change under 3 frames with no blur | lengthen to 4+ frames or switch motion blur on |
| "it drags" | a hold longer than the beat needs | trim the hold, or give it a slow drift so it reads as a pause |

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

Scale the overshoot to the mass: 3–5% for something heavy or corporate, 8–12%
for playful, 15%+ only for comedy. Each bounce should be about a third of the
one before and take fewer frames, or it reads as a wobble rather than a
settle. For springy motion that reacts to *any* keyed move, use an
inertial-bounce expression instead (see `ae-expressions`), or one of the
behaviour effects below.

## Behaviour effects (After Effects 2026)

AE 2026 ships Dynamic Effects: behaviours you drop on a property instead of
keyframing it. Confirm what this install has with
`ae_catalog {"kind": "effects", "query": "bounce"}` — they are the
`ADBE DE …` match names — and apply one with `ae_apply_effect`, which returns
the effect's real parameter names to key or drive.

| Behaviour | matchName | Use for |
|---|---|---|
| Bounce | `ADBE DE Bounce` | a settle after a keyed move, without hand-keying the decay |
| Wobble Bounce | `ADBE DE Wobble Bounce` | a softer, rubbery settle |
| Z Spring | `ADBE DE Z Spring` | depth pops on 3D layers |
| Oscillate | `ADBE DE Oscillate` | a continuous sway, a pulse, breathing |
| Pendulum | `ADBE DE Pendulum` | a hanging object, a swing that loses energy |
| Pulse / Opacity Pulse | `ADBE DE Pulse`, `ADBE DE Opacity Pulse` | attention beats, a blinking record dot |
| Jiggle | `ADBE DE Jiggle` | life, hand-held feel, nervous energy |
| Random Motion / Rotation / Scale / Opacity | `ADBE DE Random Motion`, `ADBE DE Random Rotation`, … | a crowd of elements that must not move in step |
| Follow / Swarm / Orbit / Orbit 3D | `ADBE DE Follow`, `ADBE DE Swarm`, `ADBE DE Orbit`, `ADBE DE Orbit 3D` | one layer trailing or circling another |

Most of them come in four flavours — plain, `… At Marker`, `… On Beat` and
`… Random`. The **At Marker** ones fire on layer markers, so `ae_markers` plus
a behaviour gives a decaying reaction on every beat with no keyframes at all;
the **On Beat** ones run at a rate you set.

When to use which:

- **Keyframes** when the exact pose at an exact frame matters (a lower third
  landing on a cut).
- **A behaviour** when the motion is ongoing or reactive (sway, jiggle,
  settle, orbit) and would otherwise be dozens of keys.
- **An expression** when it must be driven by something else — another
  layer's value, audio, a slider, data (`ae-expressions`, `ae-data-driven`).

Behaviours leave no keyframes, so `ae_find_animation` shows them as effects,
not animation — say so when reporting, or the next agent will think the layer
is static.

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
- **Keep the offset constant.** Uneven offsets read as a mistake rather than
  a rhythm; `ae_proof` flags them as `stagger-drift`.
- **Stagger by reading order** — left to right, top to bottom, or from the
  element the eye is already on. A cascade that starts at the far corner
  feels backwards.

## Secondary motion

One object, several parts, each stopping at its own time. It is the cheapest
way to make a move look expensive:

| Main | Secondary | Offset |
|---|---|---|
| a card lands | its shadow settles | 2–3 frames later, and softer |
| a title arrives | its underline draws | 2 frames later (Trim Paths) |
| a phone tilts | what is on its screen shifts | 1–2 frames later, a few pixels |
| a logo slams | a light sweep crosses it | 3–4 frames later |
| a chart bar grows | its value label catches up | 2 frames later, with a small overshoot |

## Arcs and anticipation

- Natural moves travel on arcs. For Position keys use `"spatial": "auto"` (or
  `"continuous"`) so the motion path curves. Use `"linear"` only for machines
  and for UI that slides along one axis.
- **Anticipation:** a small move the other way first (2–6 frames, 5–10% of
  the distance) makes the real move read as intentional. Anything heavy
  earns one; a cursor or a tooltip does not.
- **Squash and stretch** belongs to Scale, not Position: 105/95 on the axis
  of travel at the fastest frame, back to 100/100 on landing. Keep it under
  8% for anything that represents a real product.

## Motion blur and shutter

Fast motion without blur strobes. Two switches must both be on: the layer's
(`ae_set_layer_props {"props": {"motionBlur": true}}`) and the comp's
(`ae_set_comp_settings {"settings": {"motionBlur": true}}`).

| Shutter angle | Looks like |
|---|---|
| 180° | film. The default, and right most of the time |
| 90–120° | crisper, more digital; good for UI |
| 270–360° | smeared, dreamlike; good for whips and stomps |

Motion blur only blurs what the transform moves. For blur on footage that
moves *inside* the frame, use `Pixel Motion Blur` (`ADBE OFMotionBlur`); for
blur on a layer whose motion comes from an effect, `CC Force Motion Blur`.
`ae_proof`'s `strobe` check finds the layers that need this.

## Pacing a sequence

A film is not a list of moves; it is moves separated by rests.

- One idea per beat. If two things must be understood at once, one of them is
  the wrong thing to show.
- After a big move, hold. A 20-frame move followed by a 30-frame rest reads
  as confident; back-to-back moves read as panic.
- Vary the interval. Beats at exactly the same spacing feel like a metronome
  unless the piece is cut to music (`ae-audio-sync`).
- End on stillness: the last frame of a piece should not be mid-move.
  `ae_proof` flags that as `mid-move`.
- Under 10 seconds, everything is entrances and exits; over 30, you need
  changes of scale and direction or it flattens out.

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
   `ae-expressions`), or `ADBE DE Jiggle At Marker` on the null. Add a white
   solid on 1–2-frame hold keys for flash frames on the big hits.
5. **Contrast:** alternate backgrounds (dark / light / accent) every few
   beats. Put small mono sub-captions under the claims that need proof.
6. **Vary the slam.** Every word arriving the same way is a screensaver:
   alternate scale-slam, slide-in from alternating sides, and a word that
   simply cuts on with no move at all.

## Read the numbers back

`ae_layer_detail` returns each keyframe's `inSpeed`, `outSpeed` and
influences — the speed graph as numbers, in units per second. Use it to
settle arguments about feel:

- **Speed at a landing key should be 0** (or near it). A non-zero `inSpeed`
  on the last key means it stops dead while still moving — that is the
  "it snaps" note.
- **Peak speed ÷ average speed** tells you how eased a move is. Around 1.2 is
  nearly linear; 2–3 is a normal ease; over 4 is a whip that needs blur.
  Average speed is distance ÷ duration.
- **A hold is two keys with the same value.** If the speeds either side are
  not zero, the "hold" is really a slow drift.
- `ae_proof` checks the mechanical half of this automatically:
  `speed-break`, `linear`, `off-grid`, `stagger-drift`, `crowded-beat`,
  `pop`, `strobe` (`ae-motion-proof`).

## Always look

Values tell you nothing about feel. After every motion change:

- `ae_review_motion` over the move, with `frames` of about 2 per frame of
  animation, up to 48. Check that the landing decelerates, and that nothing
  arrives on the same frame as something else unless it's meant to.
- `ae_proof` reads the timing back as numbers, as above. It cannot tell you
  whether the move feels good — that is what watching is for.
- If there's a reference, compare frame by frame with the
  `video-reference-compare` skill.
- Say what you *saw* ("it lands on frame 14 and settles by 19"), not what you
  keyed.

Feel is subjective. When a choice is creative (how snappy, how much
overshoot), show a frame or the motion sheet and ask before applying it across
fifty layers.

## Turning a note into a tweak

When the user gives a timing note ("floaty", "lands late", "too bouncy",
"the cascade drags"), pass it to the preview word for word:

```json
ae_review_motion {"comp": "Launch", "start": 0, "duration": 3, "note": "the logo feels floaty and lands late"}
```

The response gains a `tweak` section:

- `motion`: every keyed move in words: how far, how many frames, how it
  eases out and lands, any overshoot. Read it against the note even when
  nothing else comes back.
- With a TypeSafe key set, `judged`: what Jev took the note to mean. That is
  the target layer, each tweak with its probability (faster, slower,
  harder_landing, softer, more_overshoot, less_overshoot, earlier, later,
  tighter_stagger, looser_stagger, longer_hold, shorter_hold, motion_blur,
  smaller_move, bigger_move) and the amount (a touch, clearly, a lot).
- `plan` and `apply`: exact `ae_edit_keyframes` edits, and one `ae_batch`
  that runs them all as a single undo step.
- `ask`: present when Jev wasn't sure which layer or which tweak the note
  means. Put that question to the user instead of guessing.

The plan is a proposal. Say what it will do ("tighten the logo's move to
70% and bring it in 6 frames earlier"), run `apply`, then preview again
with the same `note`. If the user says "more" or "too much", run it again
with that as the note: the amount follows the wording. `ae_undo` takes the
whole batch back.

The plan only retimes keyframes. It doesn't touch expression-driven motion,
text animators' selectors, or anything that isn't a Transform property, and
it reports those under `other_animation` for you to handle by hand.
