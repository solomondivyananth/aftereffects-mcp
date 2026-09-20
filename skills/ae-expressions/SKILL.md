---
name: ae-expressions
description: A tested cookbook of After Effects expressions and how to apply them through the AE MCP Bridge - wiggle and single-axis wiggle, loops, inertial bounce, marker-driven hits and shake, follow-the-leader delays, controls on a null, counters and timecode text, value remapping, and baking to keyframes. Use when motion should be procedural, driven by a control or a marker, repeat forever, or react to other layers; or when an expression errors.
---

# Expressions cookbook

Every expression here compiles in After Effects' JavaScript engine (the
default since AE 16). Apply one with `ae_set_expression`: After Effects
validates it on the way in, and if it doesn't compile the error comes back and
nothing is left attached. Use `layers` to apply it to many layers in one undo
step.

```json
ae_set_expression {"layers": {"match": "^Dot"}, "path": ["Transform","Position"],
                   "expression": "wiggle(2, 20)"}
```

Before writing one, check what's already there: `ae_find_animation` lists
every expression, with an `expressionError` field on any that's broken.

## What you can and cannot say

An expression is JavaScript with an After Effects library attached, and the
last statement is the value. It is **not** ExtendScript: `app`, `File`,
`alert`, `$` and anything that edits the project do not exist here. It is
also not a script that runs once — it runs on **every frame, for every
property that has one**.

| Available | For |
|---|---|
| `time`, `value`, `index`, `numKeys`, `thisLayer`, `thisComp` | where and when you are |
| `key(n)`, `nearestKey(t)`, `valueAtTime(t)`, `velocityAtTime(t)` | reading keyframes, your own or another layer's |
| `thisComp.marker`, `thisLayer.marker` | beats and triggers |
| `wiggle`, `random`, `gaussRandom`, `seedRandom`, `noise` | procedural motion |
| `linear`, `ease`, `easeIn`, `easeOut`, `clamp` | remapping ranges |
| `length`, `lookAt`, `toComp`, `fromComp`, `toWorld` | geometry between spaces |
| `sourceRectAtTime(t, false)` | a text or shape layer's real size |
| `footage("data.csv")` | data files (`ae-data-driven`) |
| `timeToTimecode`, `text.sourceText.style` | text |
| `posterizeTime(n)` | stepping, and speed |

**Return what the property expects**, or you get a type error: Position is
`[x, y]` or `[x, y, z]` depending on the layer's 3D switch, Scale is always
an array, Opacity and Rotation are single numbers, a colour is
`[r, g, b, a]` with each channel **0–1** (not 0–255), and Source Text is a
string.

**Engine.** Since After Effects 16 the default engine is JavaScript, where
modern syntax (`let`, `const`, arrow functions, template strings) works. A
project switched to Legacy ExtendScript takes none of that — if an
expression that is plainly valid is rejected, check which engine the project
is on and fall back to `var`.

## Controls first

Expressions are only as good as the knobs that drive them. Put controls on one
null named "Controls" so a user can restyle everything in one place:

```json
ae_create_layer {"kind": "null", "options": {"name": "Controls"}}
ae_add_property {"layer": "Controls", "path": ["Effects"], "add": "ADBE Slider Control", "name": "Speed"}
ae_add_property {"layer": "Controls", "path": ["Effects"], "add": "ADBE Color Control", "name": "Accent"}
ae_set_property {"layer": "Controls", "path": ["Effects","Speed","Slider"], "value": 1}
```

Other controls: `ADBE Checkbox Control`, `ADBE Angle Control`,
`ADBE Point Control`, `ADBE Point3D Control`, `ADBE Layer Control`,
`ADBE Dropdown Control`. Read them with
`thisComp.layer("Controls").effect("Speed")("Slider")`.

## Motion

**Wiggle** (frequency per second, amplitude in the property's units):
```js
wiggle(2, 20)
```

**Wiggle on one axis only** (on Position):
```js
var w = wiggle(2, 30);
[value[0], w[1]]
```

**Wiggle driven by controls:**
```js
var c = thisComp.layer("Controls");
wiggle(c.effect("Speed")("Slider") * 2, 25)
```

**Constant spin** (on Rotation, degrees per second):
```js
value + time * 90
```

**Loop the keyframes** (`"cycle"`, `"pingpong"`, `"offset"` builds on each loop, `"continue"` keeps the last velocity):
```js
loopOut("cycle")
```

**Inertial bounce** after any keyframed move (overshoots, then settles):
```js
var amp = 0.06, freq = 3.0, decay = 6.0;
var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) { n--; }
}
var t = n > 0 ? time - key(n).time : 0;
if (n > 0 && t < 1) {
  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);
  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);
} else {
  value;
}
```

**Follow the leader** (each layer trails the one above it by 4 frames):
```js
var leader = thisComp.layer(index - 1);
leader.transform.position.valueAtTime(time - 4 * thisComp.frameDuration)
```

**A different seed per layer** — the fix for twenty layers wiggling in
perfect unison:
```js
seedRandom(index, true);
wiggle(1.5, 20)
```

**A cascade without keyframes**, each layer delayed by its position in the
stack:
```js
var first = thisComp.layer("Card 1").index;
var delay = (index - first) * 3 * thisComp.frameDuration;
thisComp.layer("Card 1").transform.position.valueAtTime(time - delay)
```

## Driven by markers

Hits that line up with the beat. Put comp markers on the beats
(`ae_markers`), then drive from them.

**Time since the last comp marker** (the building block):
```js
var m = thisComp.marker, t = 999;
if (m.numKeys > 0) {
  var n = m.nearestKey(time).index;
  if (m.key(n).time > time) { n--; }
  if (n > 0) { t = time - m.key(n).time; }
}
t
```

**Stomp shake that decays after each marker** (on Position of a null the words are parented to):
```js
var m = thisComp.marker, t = 999;
if (m.numKeys > 0) {
  var n = m.nearestKey(time).index;
  if (m.key(n).time > time) { n--; }
  if (n > 0) { t = time - m.key(n).time; }
}
var amp = 18 * Math.exp(-t * 16);
value + [Math.sin(t * 97) * amp, Math.cos(t * 131) * amp * 0.7]
```

**Scale slam on every marker** (on Scale: 300% → 100% in 4 frames):
```js
var m = thisComp.marker, t = 999;
if (m.numKeys > 0) {
  var n = m.nearestKey(time).index;
  if (m.key(n).time > time) { n--; }
  if (n > 0) { t = time - m.key(n).time; }
}
var s = ease(t, 0, 4 * thisComp.frameDuration, 300, 100);
[s, s]
```

## Text

On `["Text","Source Text"]`:

**Count up** from 0 to 100 over two seconds:
```js
Math.round(linear(time, 0, 2, 0, 100)) + "%"
```

**Running timecode:**
```js
timeToTimecode(time)
```

**Keep the styling, change only the words** (AE 2020+ text styles):
```js
var s = thisComp.layer("Controls").effect("Speed")("Slider");
text.sourceText.style.setText("Speed " + s.value.toFixed(1) + "x")
```

## Sizing from content

`sourceRectAtTime` is what makes a layout survive text it has never seen.
On a background shape's Size, so the pill always fits the words:
```js
var t = thisComp.layer("Name");
var r = t.sourceRectAtTime(time, false);
[r.width + 80, r.height + 40]
```

And on the same shape's Position, to stay centred on that text:
```js
var t = thisComp.layer("Name");
var r = t.sourceRectAtTime(time, false);
t.toComp([r.left + r.width / 2, r.top + r.height / 2])
```

Call it once and keep the result in a variable — each call re-measures the
layer, and measuring text is the most expensive thing in this skill.

## Remapping values

`linear` and `ease` map one range onto another, clamped at both ends:

```js
ease(time, 1, 2, 0, 100)
```

(Opacity 0 → 100 between 1 s and 2 s, with ease.) Use `easeIn`/`easeOut` for
one-sided easing, and `clamp(value, lo, hi)` to cap anything.

## Follow a path

Move a layer along a shape path (on Position of the follower; the Progress
slider runs 0–100):
```js
var src = thisComp.layer("Line");
var p = src.content("Group 1").content("Path 1").path;
var pct = effect("Progress")("Slider") / 100;
src.toComp(p.pointOnPath(clamp(pct, 0, 1)))
```

Driving a dot from the path, instead of keying it separately, keeps it
exactly on the end of a growing line (pair it with Trim Paths End).

## When an expression errors

`ae_set_expression` validates on the way in: a broken expression is rejected
with its error and nothing is left attached. `ae_find_animation` catches the
other kind — expressions that were fine when written and broke later, when a
layer was renamed or deleted.

| Error says | Usually |
|---|---|
| "…is not defined" | a typo, or an ExtendScript-only name (`app`, `File`) |
| "Cannot read property … of undefined" | a layer, effect or property name that does not exist — check with `ae_comp_tree` |
| "expected 2 dimensions, got 3" (or the reverse) | the layer's 3D switch changed what Position wants |
| "class 'Number' has no method" | you returned a number where an array belongs, e.g. Scale |
| Nothing errors, but the value is frozen | the expression threw at *some* times only; check several times, not one |

**Debugging through the bridge**, in order:

1. `ae_layer_detail` on the property — it returns the expression and any
   error, plus the value.
2. Read the value at several times. An expression that is right at 0s and
   wrong at 3s is usually a marker or keyframe lookup with no guard for
   "there is nothing before me".
3. When the maths is the mystery, put a temporary Source Text expression on
   a text layer that prints the number you are chasing, and
   `ae_render_frame`. Seeing the value on screen beats reasoning about it.
4. Simplify until it works, then build back up. Half a broken expression
   that compiles tells you which half.

## Reading the numbers back

An expression produces no keyframes, so `ae_find_animation` shows it as an
expression, not as animation, and `ae_proof` has nothing to measure on that
property. Say so when reporting: "driven by an expression, so there are no
keys to check". If the motion has to be inspected or handed over, bake it.

## Baking and performance

- **Bake to keyframes** when a project must render fast, or be handed to
  someone without the controls. Select the property, then run the menu
  command. Selecting a property needs a raw script:
  `ae_run_jsx {"code": "app.project.activeItem.layer(\"Logo\").transform.position.selected = true;"}`,
  then `ae_menu_command {"command": "Convert Expression to Keyframes"}`.
- `posterizeTime(12);` as the first line gives stepped, hand-made motion,
  and makes heavy expressions cheaper.
- Avoid `sampleImage` and long `valueAtTime` loops across many layers. They
  run on every frame of every layer.
- **Cache in variables.** `thisComp.layer("Controls")` written four times is
  four lookups per frame; once, into a `var`, is one.
- **Expressions between comps** (`comp("Other").layer(…)`) work but are
  fragile: they break in a .mogrt, in Collect Files, and whenever someone
  renames the other comp. Keep references inside the comp
  (`ae-templates`).
- Rough order of cost, cheapest first: arithmetic on `value` → `wiggle` and
  `random` → reading another property → `valueAtTime` → `sourceRectAtTime` →
  `sampleImage`. Twenty layers each doing the last two is a comp nobody can
  scrub.
