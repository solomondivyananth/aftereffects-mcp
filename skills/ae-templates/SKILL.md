---
name: ae-templates
description: Build reusable templates in After Effects through the AE MCP Bridge - a Controls null that drives everything through expressions, Essential Graphics panel controls with editor-friendly names, Motion Graphics templates (.mogrt) exported for Premiere Pro, text that resizes with its box, and versioning a template for many deliverables. Use when asked for a template, a MOGRT, a lower third or title that editors can change, a reusable pack, or "make this easy to update".
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

## 4. Make it robust

A template gets abused. Build for that:

- **Long text.** Use box text (`ae_create_layer` kind `box_text`) or scale
  text to fit. On Scale:
  ```js
  var w = sourceRectAtTime(time, false).width;
  var max = 900;
  var s = w > max ? 100 * max / w : 100;
  [s, s]
  ```
- **Backgrounds that follow the text.** A shape's Rectangle Size can read
  the text's width: `var r = thisComp.layer("Name").sourceRectAtTime(time, false); [r.width + 80, r.height + 40]`.
- **Timing that survives edits.** Put the in and out animation in the first
  and last second, and hold in between. Editors trim the middle, so an
  animation there gets cut.
- **Fonts.** Use a font every editor has, or say which font is required.
  `ae_text` reports the font.
- **Test with bad data.** Before exporting, set the text to something very
  long, something very short, and an empty string. `ae_render_frame` each one.

## 5. Many versions from one template

For a batch of versions (a name per speaker, a colour per brand), don't
duplicate by hand. Use `ae_batch`: for each version, `ae_duplicate_comp`,
then `ae_text` and `ae_set_property` on the Controls, then `ae_render_queue`
`add` with its own output name. Then run one background render per item, or
send the queue to Media Encoder (`ae-deliver`). For versions driven by a
spreadsheet, see `ae-data-driven`.
