---
name: ae-data-driven
description: Drive After Effects from data through the AE MCP Bridge - import CSV, TSV or JSON as footage and read it in expressions (dataValue, sourceData), build animated bar charts and counters from a spreadsheet, or have the agent read the data and generate one version per row with batch tool calls. Verified in After Effects. Use when asked to animate data, make a chart or infographic, build versions from a spreadsheet or JSON (names, prices, scores, cities), or keep a comp updated when numbers change.
---

# Data-driven animation

There are two ways to drive a comp from data. Choose by whether the data
should stay **live**:

| Approach | When |
|---|---|
| **A. Data as footage + expressions.** The file is in the project and expressions read it. | The numbers will change and the comp should update. One comp shows many values (charts). |
| **B. The agent reads the data and builds with tool calls.** | One output per row (versions, cards, social tiles), or the data needs cleaning first. |

Whichever you pick, **look at the data before you build anything**: row
count, the longest string, the biggest and smallest number, empty cells. Two
minutes there saves rebuilding forty comps.

## Clean data first

After Effects is unforgiving about file details, and every one of these
fails quietly rather than loudly:

| Trap | What it does | Fix |
|---|---|---|
| A byte-order mark or odd encoding | the first header is unreadable, `dataValue` returns nothing | save as plain UTF-8 |
| Semicolons as separators (European exports) | the whole row is one column | save as comma-separated, or use `.tsv` |
| Decimal commas (`3,5`) | `Number()` gives NaN | convert to points before importing |
| Thousands separators (`1,200`) | splits the column, or NaN | strip them; format for display in the expression instead |
| Spaces in headers or values | lookups by name miss | trim them |
| Mixed types in a column | some rows animate, some do not | decide the type per column and enforce it |
| A trailing empty line | one blank extra row | remove it, or check the row count |

## A. Data files as footage

`ae_import_file` a `.csv`, `.tsv` or `.json`. It becomes a footage item named
after the file. Expressions read it with `footage("<file name>")`.

**JSON:** `sourceData` is the parsed object.

```js
var d = footage("data.json").sourceData;
d.title + ": " + d.items[0].label + " " + d.items[0].value
```

**CSV / TSV:** use `dataValue([column, row])`. Both count from 0, and the
header row is **not** counted, so `[0, 0]` is the first data row's first
column. Values come back as text: wrap numbers in `Number()`. `sourceData` is
empty for CSV, so don't use it.

```js
footage("data.csv").dataValue([1, 2])
```

(Third data row, second column.)

### Bar chart recipe

For each row, one shape bar grows from a baseline to its value:

```json
ae_shape {"name": "Bar 1", "shape": "rect", "size": [80, 400], "position": [0, -200], "fill": "#7a5cff"}
ae_set_property {"layer": "Bar 1", "path": ["Transform","Position"], "value": [400, 900]}
```

The rectangle sits above the layer's origin (position `[0, -200]` for a
400-tall bar), so scaling Y grows it up from the baseline at y 900. Scale
from the data, with a staggered ease-in (row *r* starts 0.1 s later):

```js
var v = Number(footage("data.csv").dataValue([1, 0]));
var grow = ease(time, 0.2, 1.0, 0, 1);
[100, v * grow]
```

Here the value is used as a percentage of the bar's full height. For other
ranges, normalise it first: `v / maxValue * 100`.

Colour from a hex column, on
`["Contents","Bar 1","Contents","Fill 1","Color"]`:

```js
hexToRgb(footage("data.csv").dataValue([2, 0]))
```

Label and value text use Source Text expressions. Counters that roll up use
`Math.round(linear(time, t0, t1, 0, value))` (see `ae-expressions`).

Build all the bars in one `ae_batch`, one set of calls per row, changing only
the row index and the x position.

### Beyond bars

| Chart | How to build it |
|---|---|
| Stacked bars | one bar layer per series, each offset by the sum of the ones below — compute the offsets yourself and write them as values |
| Donut or progress ring | a shape ellipse with a stroke and Trim Paths; End = `value / max * 100` |
| Line chart | build the path from the data yourself and write it with `ae_shape` as a `path`, then reveal it with Trim Paths. Expressions cannot make a path out of a CSV; arithmetic in your own head can |
| Scatter | one small shape per row, positioned from two columns, staggered in |
| Table or leaderboard | one row precomp, duplicated per row, each with its own text; sort the rows yourself before building |
| A counter | `Math.round(linear(time, t0, t1, 0, value))` on Source Text |

**Scale everything to one maximum.** Find the biggest value across the rows
yourself and write it into the build (or into a Slider on the Controls
null), so all the bars share one scale. A chart where each bar is scaled to
its own maximum is a lie.

**Round for reading, not for maths.** Show whole numbers, or one decimal;
put the unit in the label, not on every bar.

**Number formatting** matters more than the animation: pad counters to a
fixed width and use tabular figures, or the text reflows every frame and
shimmers (`ae-typography`).

### Live or baked

Expressions re-evaluate every frame, on every layer. Forty bars each reading
a CSV is slow to preview and slow to render.

- Keep it live while the numbers are still changing.
- Once they are final, bake it: `ae_menu_command {"command": "Convert
  Expression to Keyframes"}` with the property selected (Animation ▸
  Keyframe Assistant). If the command name differs in this version the tool
  says so — look it up rather than guessing.
- Or skip expressions entirely and have the agent write plain keyframes from
  the data in one `ae_batch`. For a one-off chart that is both faster to
  build and faster to render.

### Updating

Replace the data file on disk and use `ae_item_action {"action": "reload",
"item": "data.csv"}`. Every expression picks up the new numbers. To point at
a different file, use `ae_item_action {"action": "replace_source", …}`.

## B. One version per row

When each row is its own deliverable (a name card per speaker, a price tile
per product):

1. Read the file yourself and check it. Trim spaces, flag empty cells and
   over-long text, and confirm the row count with the user before building 40
   comps.
2. Build **one master comp** whose changeable parts are on a Controls null
   and in named text layers (see `ae-templates`).
3. For each row, in one `ae_batch` per row:
   `ae_duplicate_comp` (name it from the row, e.g. `Card - Oslo`), then
   `ae_text` on each text layer, then `ae_set_property` for the Controls
   (colours, switches).
4. Check a few versions, especially the longest text: `ae_render_frame`.
5. Queue them: `ae_render_queue {"action": "add", "comp": …, "output": …}` per
   version, then render or send to Media Encoder (`ae-deliver`). Name the
   outputs from the row.

## Pitfalls

| Symptom | Cause |
|---|---|
| Value is off by one row | the CSV header row isn't counted, so row 0 is the first data row |
| Bars don't scale, the expression error mentions NaN | the CSV value is text: wrap it in `Number()` |
| `sourceData` is null | it's a CSV: use `dataValue` |
| Expression can't find the footage | the name must match the Project panel item exactly, extension included (check with `ae_list_items`) |
| Bars grow from the middle | the shape isn't offset above the layer's origin: set the rect's position to minus half its height |
| Numbers jitter as they count | proportional figures reflow every frame | pad the string and use a tabular font |
| Everything previews slowly | dozens of per-frame expressions reading a file | bake to keyframes, or build the values in |
| A reloaded file changes nothing | the item was replaced on disk but not reloaded | `ae_item_action {"action": "reload"}` |

## Check it

Render the chart at its final state and read the bars and labels back
against the data (`ae_render_frame`) — literally compare each number on
screen with the source row. A chart that animates beautifully and shows the
wrong figure is the worst outcome in this skill.

Then `ae_review_motion` over the build to check the stagger, and `ae_proof`
for the mechanical faults data tends to cause: labels overlapping their bars
when a value is small, text clipped by the frame when a name is long,
uneven stagger across generated rows (`ae-motion-proof`).

Before delivering versions, spot-check the first row, the last row, the
longest text and the largest and smallest values.
