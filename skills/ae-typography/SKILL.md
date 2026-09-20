---
name: ae-typography
description: Kinetic typography in After Effects through the AE MCP Bridge - text animators and selectors (range, wiggly, expression), word-by-word blur-in, per-letter waves, scatter and reassemble, typing cursors, stretched words, selection-highlight wipes, gradient-filled words, text on a circle path that becomes a ring, repeated-row patterns, and depth-of-field word clouds, all verified in After Effects. Use when asked to animate text or titles, build kinetic type, make words appear, type on, wave, scatter, or when text animation looks flat.
---

# Kinetic typography

Almost every text effect is one **text animator**: some properties (Opacity,
Blur, Position, Scale, Fill Color, Tracking) plus a **selector** that decides
which characters get them, and how much. Animate the selector, not the text.

## Type that reads, before it moves

Animation cannot rescue type that is set badly. Numbers that hold up at
delivery size, for a 1080-tall frame (scale them by the frame's short side):

| | Value |
|---|---|
| Smallest legible size | ~24 px (2.2% of the short side). `ae_proof` flags anything under it |
| A title people read in passing | 64–120 px |
| A full-frame statement | 140–260 px |
| Line length | 28–45 characters, including spaces |
| Leading | 1.1–1.25× the size for titles, 1.4× for body |
| Tracking for ALL CAPS | +40 to +80 |
| Tracking for large display type | −20 to −40; big type needs tightening |

- **Size from the copy, not from a number you like.** Long copy in a fixed
  size overflows the frame; `Math.min(base, frameWidth * 0.86 / (chars * 0.55))`
  keeps any line inside. The templates in `ae-ai-templates` all do this.
- **Fonts are PostScript names**, and the font must be installed. Look one up
  with `ae_catalog {"kind": "fonts", "query": "Inter"}` instead of guessing —
  a name After Effects doesn't have is silently substituted, and the render
  is wrong in a way no error tells you about.
- **Two weights beat two families.** Contrast by weight and size; keep one
  family per piece unless the brand says otherwise.

## Building an animator

```json
ae_add_property {"layer": "Title", "path": ["Text","Animators"], "add": "ADBE Text Animator",
                 "name": "In", "animate": ["ADBE Text Opacity", "ADBE Text Blur", "ADBE Text Position 3D"]}
ae_add_property {"layer": "Title", "path": ["Text","Animators","In","Selectors"], "add": "ADBE Text Selector"}
```

Properties are at `["Text","Animators","In","Properties","Opacity"]`. The
selector is at `["Text","Animators","In","Selectors","Range Selector 1"]`.
Its Advanced options are one level deeper, under `"Advanced"`.

| Animator property | matchName | Value |
|---|---|---|
| Opacity | `ADBE Text Opacity` | 0–100 |
| Blur | `ADBE Text Blur` | `[x, y]` |
| Position | `ADBE Text Position 3D` | `[x, y, z]`, offset from rest |
| Scale | `ADBE Text Scale 3D` | `[x, y, z]` % |
| Rotation | `ADBE Text Rotation` | degrees |
| Tracking | `ADBE Text Tracking Amount` | units |
| Fill Color | `ADBE Text Fill Color` | colour |
| Skew, Anchor Point, Character Offset, Stroke Color, Line Spacing | `ADBE Text Skew`, `ADBE Text Anchor Point 3D`, `ADBE Text Character Offset`, `ADBE Text Stroke Color`, `ADBE Text Line Spacing` | |

| Selector | matchName | Use |
|---|---|---|
| Range Selector | `ADBE Text Selector` | reveal in order: animate Offset or Start/End |
| Wiggly Selector | `ADBE Text Wiggly Selector` | random per-character amounts: scatter, jitter |
| Expression Selector | `ADBE Text Expressible Selector` | any per-character formula (`textIndex`, `time`): waves |

Range Selector › Advanced values are numbers:

| Setting | Values |
|---|---|
| Based On | 1 characters · 2 characters excluding spaces · 3 words · 4 lines |
| Shape | 1 square · 2 ramp up · 3 ramp down · 4 triangle · 5 round · 6 smooth |
| Units | 1 percentage · 2 index |

### Driving a selector

Three ways, and they are not interchangeable:

| Drive | What it does | Use when |
|---|---|---|
| **Offset** (with Start 0, End 100) | slides the whole range across the text | a reveal in reading order — the common case |
| **Start** or **End** | grows or shrinks the range from one end | a wipe that stops part way, a highlight that stays |
| **Amount** on the animator | fades the whole effect in and out at once | a treatment that applies to everything, e.g. a blur pulse |

**After you switch Units to index**, address Start and End by matchName —
`ADBE Text Index Start` and `ADBE Text Index End`. The percentage versions
still exist, hidden, and keying them does nothing. This costs an hour if you
don't know it.

**Shape and Smoothness are the feel.** Shape 1 (square) with Smoothness 0
gives hard per-character cuts — typewriter, counters, glitch. Shape 2 (ramp
up) with Smoothness 100 gives the soft premium wash. Shape 5 (round) reads as
a bulge travelling through the word. Ease High and Ease Low bias the range's
edges: Ease High 100 makes characters linger at full effect, Ease Low 100
makes them leave slowly.

**Stacked animators are applied in order, and they add.** Two animators each
moving Position by 20 px move the character 40. Name them for what they do
("In", "Shimmer", "Exit"), because every later tool call finds them by name,
and an unnamed third "Animator 3" is how the wrong property gets keyed.

## Recipes

**Word-by-word arrival with a soft blur settle.** This is the calm, premium
reveal. Animator with Opacity 0, Blur `[12, 12]`, Position `[0, 24, 0]`.
Range Selector Based On 3 (words), Shape 2 (ramp up). Keyframe Offset
−100 → 100 over about 1 s, with a landing ease of 70–85:

```json
ae_set_property {"layer": "Title", "path": ["Text","Animators","In","Selectors","Range Selector 1","Advanced","Based On"], "value": 3}
ae_set_property {"layer": "Title", "path": ["Text","Animators","In","Selectors","Range Selector 1","Advanced","Shape"], "value": 2}
ae_add_keyframes {"layer": "Title", "path": ["Text","Animators","In","Selectors","Range Selector 1","Offset"],
                  "keys": [{"time": "0f", "value": -100}, {"time": "30f", "value": 100, "ease": {"in": 80}}]}
```

For characters instead of words, use Based On 1, a shorter Offset move, and
Smoothness around 100.

**Travelling per-letter wave.** Animator with Position `[0, -28, 0]`, plus
an Expression Selector whose Amount runs a wave along the word:

```js
var s = Math.max(0, Math.sin(time * 7 - textIndex * 0.55)) * 100;
[s, s, s]
```

(Amount is three-dimensional, hence the array.) Raise the multiplier on
`textIndex` for a shorter wavelength. Add Fill Color to the same animator for
a tint that rides along with the crest.

**Scatter, then reassemble into new words.** Animator with Position (and
Rotation) plus a Wiggly Selector with Wiggles/Second 0, which gives each
letter a fixed random offset. Keyframe the animator's Position from
`[0, 0, 0]` to `[260, 180, 0]` to blow the letters apart. For the next
phrase, make a second text layer with the same animator keyed the opposite
way (`[260, 180, 0]` → `[0, 0, 0]`). Overlap the two by 4–6 frames, so one
set of letters flies out while the next flies in and it reads as the letters
rearranging.

**Typing with a blinking cursor** (on `["Text","Source Text"]`):

```js
var full = "Draft a reply";
var n = Math.floor(linear(time, 0.5, 2.0, 0, full.length));
var cursor = (Math.floor(time * 2) % 2 === 0) ? "|" : " ";
full.substr(0, n) + cursor
```

**A word that stretches** (a letter repeated as time passes), for emphasis
without a new layer:

```js
var n = Math.round(linear(time, 3, 4, 1, 14));
var o = "";
for (var i = 0; i < n; i++) { o += "o"; }
"so" + o + " much"
```

Sweep a gradient bar across it (next recipe) while it grows.

**Selection-highlight wipe.** A rounded rectangle behind one word, like
text selected in an editor. It wipes on from the left, holds, and wipes off
to the right as the next line arrives. Build it with `ae_shape` (a rect with
a gradient-coloured fill, placed under the text layer). Put the anchor at the
left edge (`ae_layer_action {"action": "center_anchor"}`, then offset the
anchor to the left edge) and keyframe Scale X 0 → 100 over 4–6 frames. For
the exit, move the anchor to the right edge and keyframe 100 → 0.

**Gradient-filled words.** Text Fill Color is flat. For a gradient across a
word, duplicate the text layer, put a `ADBE Ramp` (Gradient Ramp) solid above
it, and set the solid's `trackMatte` to the text layer (`type: "alpha"`).
Animate the ramp's Start of Ramp and End of Ramp slowly for a living
gradient.

**Text on a circle, becoming a ring.** Masks on a text layer are in the
layer's own space, where `[0, 0]` is the text's anchor. So centre the circle
on zero:

```json
ae_masks {"layer": "Orbit", "action": "add", "mask": {"ellipse": [-220, -220, 440, 440], "mode": "none"}}
ae_set_property {"layer": "Orbit", "path": ["Text","Path Options","Path"], "value": 1}
ae_add_keyframes {"layer": "Orbit", "path": ["Text","Path Options","First Margin"],
                  "keys": [{"time": "0f", "value": 0}, {"time": "90f", "value": 1200}]}
```

Path `1` means Mask 1. Text sits on top of the path, so make the ring shape
slightly smaller than the mask. Draw the ring on with `ae_shape` (an ellipse
with a stroke and `trim: {"start": 0, "end": 0}`), keyframe Trim Paths End
0 → 100, and add Glow (`ADBE Glo2`) for a light ring. To morph the line of
text into the ring: start with the text on a straight path, then key the
mask path from a flat line to the circle (see `ae-morph`).

**Repeated rows, alternating directions.** Five to seven copies of the same
line, stacked with tight leading. Alternate rows use Position expressions
that drift left and right (`value + [time * 60, 0]` and `value - [time * 60, 0]`).
Use one bold, full-opacity row in the middle and fade the others by distance
from centre. `ae_batch` builds the copies in one undo step.

**Depth-of-field word cloud.** Make each word its own 3D text layer
(`threeDLayer: true`) at a different Z (−600 to +1200) and size, add a camera
with Depth of Field on, and dolly it forward through the cloud. Words sharpen
as they cross the focus distance. The camera rig, focus and depth are in
`ae-camera-3d`.

## Text boxes, and text that changes

- **Point text grows from its anchor; box text wraps inside a fixed
  rectangle.** Box text is what to use for anything data-driven or
  client-editable, because it wraps instead of running off the frame. Its
  cost: text that doesn't fit is simply not drawn, with no warning.
  `ae_proof`'s `text-overflow` catches both cases.
- Justification changes what the anchor means. For centred type, centre the
  anchor too, or every size change drifts sideways.
- **Source Text keyframes are holds.** Keying the words themselves snaps from
  one string to the next — there is no interpolation. That is what you want
  for counters and label changes; for a crossfade between two sentences, use
  two layers.
- Numbers that count up belong in an expression on Source Text, not in
  twenty keyframes. Wrap them so the digits don't jitter: pad to a fixed
  width, and prefer a monospaced (tabular) figure style, or the line reflows
  on every frame and shimmers.

## When it looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| The animator does nothing | the range covers nothing, or Amount is 0 | check Start/End (and index-units matchNames above) |
| Characters jitter or shimmer | animated Tracking reflows the line every frame | animate Position or Scale instead, or accept it and add a little blur |
| The whole line moves as one | Based On is words or lines, or there is no selector | set Based On 1, add a Range Selector |
| The reveal feels mechanical | Shape 1 with Smoothness 0, or a linear Offset | Shape 2, Smoothness 80–100, landing ease 70–85 |
| Blur makes the type mushy | Blur is in pixels and small type has little to lose | blur 8–14 on display type only, and settle it to 0 well before the hold |
| The fill colour ignores your gradient | a Fill Color animator overrides the matte trick | remove Fill Color from the animator, or drive the ramp instead |
| Text reads for a moment then goes | the hold is shorter than the copy | ~3 words a second; `ae_proof`'s `read-time` gives the number |

## Taste

- One idea per line. Let a line hold long enough to read (about 3 words a
  second) before the next arrives.
- Keep entrances softer than exits. Arrive with blur and ease; leave faster.
- Use one accent treatment (a gradient word, a highlight) per phrase, not
  one per word.

## Check it

Text animation is judged in motion. `ae_review_motion` over each line's
entrance, and `ae_render_frame` at the moment each line is fully readable —
at `downscale: 1` if you are judging legibility, because a shrunken contact
sheet flatters small type.

Then `ae_proof` on the comp (`ae-motion-proof`): it screens type for
`text-small`, `text-overflow`, `read-time` (on screen for less time than it
takes to read) and `text-copy` (double spaces, straight quotes, "..." where
an ellipsis belongs). Read the words back with `ae_text` to catch typos —
nothing else in the toolchain will.
