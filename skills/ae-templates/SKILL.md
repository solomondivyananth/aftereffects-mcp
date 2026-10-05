---
name: ae-templates
description: Build reusable templates in After Effects through the AE MCP Bridge - a Controls null that drives everything through expressions, Essential Graphics panel controls with editor-friendly names, Motion Graphics templates (.mogrt) exported for Premiere Pro, text that resizes with its box, rigs an animator can still key, and versioning a template for many deliverables. Use when asked for a template, a MOGRT, a lower third or title that editors can change, a reusable pack, or "make this easy to update".
---

# Templates

A template is a comp someone else can change without opening its guts: the
text, the colours, a few switches, and nothing that breaks. Design the
controls first, then build everything to read from them.

## 1. One place for every knob

Put every changeable value on a null named **Controls**, as expression
controls. Every animated element reads from it (see `ae-expressions`):

```json
ae_create_layer {"kind": "null", "options": {"name": "Controls"}}
ae_add_property {"layer": "Controls", "path": ["Effects"], "add": "ADBE Color Control", "name": "Accent"}
ae_add_property {"layer": "Controls", "path": ["Effects"], "add": "ADBE Checkbox Control", "name": "Show Line"}
ae_add_property {"layer": "Controls", "path": ["Effects"], "add": "ADBE Slider Control", "name": "Speed"}
```

| Control | matchName | Read it with |
|---|---|---|
| Colour | `ADBE Color Control` | `effect("Accent")("Color")` |
| Checkbox | `ADBE Checkbox Control` | `effect("Show Line")("Checkbox")` (1 or 0) |
| Slider | `ADBE Slider Control` | `effect("Speed")("Slider")` |
| Angle | `ADBE Angle Control` | `effect("Tilt")("Angle")` |
| Point | `ADBE Point Control` | `effect("Offset")("Point")` |
| Dropdown | `ADBE Dropdown Control` | `effect("Style")("Menu")` (1-based). Its item names are set in the Effect Controls, so ask the user or leave the defaults |

Wire them up with expressions. For example, a line layer's Opacity:
`thisComp.layer("Controls").effect("Show Line")("Checkbox") * 100`. A shape
fill's colour: `thisComp.layer("Controls").effect("Accent")("Color")`.

**Name controls for the person, not the build.** "Accent colour", "Show
line", "Speed" — not "ctrl_01". Whatever you write here is what an editor
sees in Premiere, and it cannot be renamed from the other end.

## 2. Expose them in Essential Graphics

`ae_essential_graphics` puts properties in the Essential Graphics panel under
names an editor understands, in the order given:

```json
ae_essential_graphics {"comp": "Lower Third", "action": "add", "properties": [
  {"layer": "Name",     "path": ["Text","Source Text"],                 "name": "Name"},
  {"layer": "Title",    "path": ["Text","Source Text"],                 "name": "Job title"},
  {"layer": "Controls", "path": ["Effects","Accent","Color"],           "name": "Accent colour"},
  {"layer": "Controls", "path": ["Effects","Show Line","Checkbox"],     "name": "Show line"}]}
ae_essential_graphics {"comp": "Lower Third", "action": "set_name", "name": "Simple Lower Third"}
ae_essential_graphics {"comp": "Lower Third", "action": "list"}
```

Supported values are Source Text, colours, checkboxes, sliders, angles,
points and similar simple values. Groups like Transform are refused with a
clear error. Expose the *controls*, not the raw properties they drive, so
one "Accent colour" recolours everything.

## 3. Export a .mogrt

```json
ae_essential_graphics {"comp": "Lower Third", "action": "export",
                       "file": "/path/to/Templates/Simple Lower Third.mogrt", "overwrite": true}
```

Pass a folder, or a path ending in `.mogrt`: the file name becomes the
template name. Export last: After Effects attaches one invisible step to the
next edit after an export, so the first `ae_undo` after that may seem to do
nothing. Check with `ae_comp_tree` before undoing again. Editors add the file in Premiere Pro's Essential Graphics
panel. `action: "open"` shows the panel in After Effects if the user wants to
arrange it by hand (grouping and comments are done there).

## Timing an editor can trim

An editor will drag the ends of your template on their timeline. If the
animation sits anywhere but the first and last second, trimming cuts it in
half.

- Put the in-animation in the first second and the out in the last, with a
  hold between. Then any duration works.
- **Responsive Design – Time** marks those sections as protected so trimming
  only eats the hold. It is set in the Essential Graphics panel by hand —
  not scriptable — so build the template to suit it and ask the user to mark
  the protected regions before exporting (`ae_essential_graphics
  {"action": "open"}` brings the panel up).
- Keep the out-animation shorter than the in. Editors trim the tail far more
  often than the head.

## What a .mogrt cannot take with it

A .mogrt is self-contained, which means everything outside the comp is left
behind. Before exporting, check for:

| Problem | What happens in Premiere | Fix |
|---|---|---|
| An expression pointing at a layer in another comp | the expression errors and the property freezes | keep every reference inside the template comp, or precompose so it is |
| A font the editor does not have | silent substitution | use a common font, or state the requirement in the template name |
| Third-party effects | the template refuses to load or the effect is skipped | build the look from stock effects (`ae-effects`) |
| Footage the template needs | the media is missing | package it as media replacement, which is set in the panel by hand |
| Expression controls not exposed | the editor can see the result but change nothing | expose the Controls, not the properties they drive |

Export, then re-import the .mogrt into a fresh project (or ask the user to
try it in Premiere) before calling it done. A template that only works on
the machine that built it is not a template.

## 4. Make it robust

A template gets abused. Build for that:

- **Long text.** Use box text (`ae_create_layer` kind `box_text`) or scale
  text to fit. On Scale:
  ```js
  var w = sourceRectAtTime(inPoint + 1.5, false).width;
  var max = 900;
  var s = (w > max) ? 100 * max / w : 100;
  [s, s]
  ```
  Measure the finished line (here 1.5 s after the layer starts, once any
  type-on is complete), not the current frame. Measured at `time`, the width
  changes as the text types on and off, so the scale changes with it and the
  text visibly breathes. If the text is empty the width is 0, and the
  `w > max` test keeps that from dividing by zero.
- **Backgrounds that follow the text.** A shape's Rectangle Size can read
  the text's width: `var r = thisComp.layer("Name").sourceRectAtTime(time, false); [r.width + 80, r.height + 40]`.
- **Timing that survives edits.** Put the in and out animation in the first
  and last second, and hold in between. Editors trim the middle, so an
  animation there gets cut.
- **Fonts.** Use a font every editor has, or say which font is required.
  `ae_text` reports the font.
- **Test with bad data.** Before exporting, set the text to something very
  long, something very short, and an empty string. `ae_render_frame` each
  one, and run `ae_proof` on the longest version — `text-overflow`,
  `overlap` and `clipped` are exactly what over-long copy causes
  (`ae-motion-proof`).
- **Lock what must not move.** `ae_set_layer_props {"props": {"locked":
  true}}` on background and guide layers, so a person poking at the comp
  cannot drag them.
- **Leave the comp tidy.** Controls at the top, unique layer names, no
  disabled experiments left behind. The next person to open it reads the
  layer stack as documentation.

### Rigs an animator can still key

A template that animates itself is only useful if a person can still change
the motion. Build so automatic motion and hand keys add up:

- **Automatic motion goes on a parent.** Put a float, bob or drift on a null
  and parent the layer to it. The layer's own Transform stays free for the
  animator's keys, and removing the effect means unparenting, not
  untangling an expression.
- **Offsets add to `value`.** `value` already includes the layer's own
  keyframes, so an expression that adds to it keeps them working. On
  Position:
  ```js
  var c = thisComp.layer("Controls");
  value + [c.effect("Nudge X")("Slider"), c.effect("Nudge Y")("Slider")]
  ```
  An expression that *replaces* `value` (`[960, 540] + …`) silently throws
  away every key a person sets. Test it: key the layer by hand, and the
  result should be your key plus the offset.
- **Zero means untouched.** Every amount control (Parallax, Float, Shake) at
  0 must give back the exact layout without the rig. Render a frame at 0 and
  compare it with the layer's own values.
- **Parent first, then key.** When you parent, After Effects keeps the child
  where it is by working out its transform relative to the parent at that
  moment. If the parent is at Scale 0 or mid-spin then, the child gets a
  broken transform and renders offset or cropped. Parent while the parent is
  at rest (Scale 100, Rotation 0), and before keying the parent, or park the
  playhead on a rest frame first (`ae_goto`).
- **Shared precomps are shared.** Before editing a precomp, check which comps
  use it: `ae_list_items {"kind": "comp"}` gives every item's `usedIn`. An
  entrance you add for one scene also plays in the montage that uses the
  same precomp at time 0. Duplicate it with `ae_duplicate_comp`
  when only one use should change.

## Before you hand it over

| Check | How |
|---|---|
| Every knob is exposed and named | `ae_essential_graphics {"action": "list"}` |
| Nothing breaks at extremes | longest copy, shortest copy, empty string, and both themes if there is a switch |
| One accent recolours everything | change the Controls colour, render a frame |
| It survives trimming | shorten the comp, render the last frame |
| It is mechanically clean | `ae_proof` on the comp |
| The .mogrt loads elsewhere | re-import it, or have the user try it in Premiere |

## 5. Many versions from one template

For a batch of versions (a name per speaker, a colour per brand), don't
duplicate by hand. Use `ae_batch`: for each version, `ae_duplicate_comp`,
then `ae_text` and `ae_set_property` on the Controls, then `ae_render_queue`
`add` with its own output name. Then run one background render per item, or
send the queue to Media Encoder (`ae-deliver`). For versions driven by a
spreadsheet, see `ae-data-driven`.
