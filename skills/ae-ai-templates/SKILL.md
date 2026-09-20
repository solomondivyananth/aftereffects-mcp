---
name: ae-ai-templates
description: Use and write AI-native After Effects templates through the AE MCP Bridge - finished animated designs (lower third, kinetic title, word reveal, app card, bar chart, logo sting, welcome) that an agent fills from a brief with ae_template, built as one undo step with a contact sheet to check, in 16x9, 9x16, 1x1 or 4x5; plus how to author a new template as JSON (typed slots, steps, expressions, repeats) that npm test validates. Use when asked for a lower third, title, chart, logo sting, app or UI shot, a quick branded animation, "make me a template", or to turn a design into something reusable.
---

# AI-native templates

A template here isn't an `.aep` someone opens and edits. It's a **recipe**:
typed slots (text with length limits, colours, lists, options) plus the
bridge steps that build the design. An agent fills the slots from a brief,
and the whole design builds in one call. Every build still gets a Controls
layer and Essential Graphics controls, so a person can adjust it afterwards.

## Using one

```json
ae_template {"action": "list"}
ae_template {"action": "describe", "template": "lower-third"}
ae_template {"action": "build", "template": "lower-third", "format": "9x16",
             "values": {"name": "Priya Raman", "title": "Founder, Loop Studio", "accent": "#ff7a3d"}}
```

- **Read `describe` first.** Every slot has a type, a default, limits and a
  one-line `describe`. Text over its `maxChars` is refused with the exact
  count: shorten it, don't ask to squeeze it in. The limit is where the
  design stops fitting.
- **Build.** It's one undo step (`MCP: Template · …`), and on any failure
  the whole build is rolled back, so nothing is left half-made. The result
  includes a contact sheet. Look at it before saying it's done.
- **Proof it.** `ae_proof {"comp": "…"}` on the built comp catches copy that
  collides or runs off the edge in a format you didn't look at closely
  (`ae-motion-proof`).
- **Formats.** Pass `format` for social cuts. Layouts adapt; they aren't
  just cropped.
- **Change it later.** Rebuild with new values (the fastest and cleanest
  way), or edit the Essential Graphics controls or the Controls layer.
- **Then deliver** with `ae-deliver`: pre-flight, render, verify.

| Template | For | Key slots |
|---|---|---|
| `lower-third` | names and titles over footage | name, title, accent, theme, backdrop |
| `kinetic-title` | stomp typography on a beat | words (list), beat, accent, font, shake |
| `word-reveal` | calm premium title on a drifting gradient | headline, sub, accent, accent2 |
| `app-card` | app or AI launch shot, 3D UI panel | greeting, prompt, chips (list), accent |
| `bar-chart` | animated data | title, items [{label, value}], unit, accent |
| `logo-sting` | brand sting with rings and a flare | wordmark, tagline, accent, accent2 |
| `welcome` | the bridge's own welcome (also `ae_welcome`) | accent, font |

`ae_welcome` builds the welcome template and opens it. It's also the
quickest way to prove a new install works end to end.

## Choosing and filling from a brief

1. Pick the template whose *purpose* matches the brief, not its look.
   The look is controlled through the slots.
2. Map the brief's content onto slots. Keep the copy within the limits.
   Split long lines into the template's list slots where it has them.
3. Use the brand's colours as hex. If the brief gives none, keep the
   defaults.
4. Fonts: slots take a PostScript name, and the font must be installed.
   Look it up with `ae_catalog {"kind": "fonts", "query": "…"}` rather than
   guessing.
5. Build, look at the contact sheet, and adjust values and rebuild if the
   copy wraps oddly or colours clash.

## Writing a new template

A template is `templates/<name>.json`:

```json
{
  "name": "quote-card", "title": "Quote Card",
  "description": "What it is for and what it looks like, for the agent choosing one.",
  "formats": ["16x9", "9x16", "1x1"],
  "duration": 6, "fps": 30,
  "slots": {
    "quote": { "type": "text", "default": "…", "maxChars": 120, "required": true, "describe": "…" },
    "accent": { "type": "color", "default": "#7a5cff", "describe": "…" }
  },
  "steps": [
    { "let": { "size": "{{Math.min(64 * S, W * 0.8 / (quote.length * 0.4))}}" } },
    { "tool": "ae_create_comp", "args": { "name": "{{comp}}", "width": "{{W}}", "height": "{{H}}", "duration": "{{dur}}", "frameRate": "{{fps}}" } },
    { "tool": "ae_create_layer", "args": { "comp": "{{comp}}", "kind": "text", "options": { "name": "Quote", "text": "{{quote}}", "style": { "fontSize": "{{size}}" } } } }
  ]
}
```

**Slots:** `text` (maxChars, required), `color` (hex), `number`
(min, max), `enum` (values), `bool`, `list` (item `"text"` with maxChars, or
an object of fields; minItems, maxItems). Every slot needs a `default` and a
`describe`.

**Steps** are bridge tool calls, run in order inside one `ae_batch`:
- `"{{expr}}"` as a whole value gives a typed result (number, array); inside
  a longer string it's inserted as text.
- `{"let": {...}}` defines names for later steps.
- `{"when": "expr", ...}` skips a step when false.
- `{"repeat": {"over": "list", "as": "item", "index": "i"}, "steps": [...]}`
  loops.
- `duration` may be an expression, e.g. `"(len(words) * beat + hold) / fps"`.

**Names available** in expressions: every slot, `data` entries, `comp`,
`W`, `H`, `fps`, `dur`, `cx`, `cy`, `S` (scale, 1 at 1080), `portrait`,
`format`, `toolCount`, `skillCount`, `Math`, and the helpers
`len(x)`, `max(list, key)`, `pick(list, i)`, `upper(s)`, `fixed(n, d)`.
Expressions are arithmetic, comparisons, `?:` and calls. There are no
assignments and no `{}` objects; for alternatives, write two steps with
`when`. Slot values are data, never code.

**Rules that keep templates solid** (each one was learned by breaking it):
- Put a **Controls** null first, and drive colours from it with
  expressions, so one Essential Graphics control recolours everything.
- **Size text from its length and the frame**
  (`Math.min(base * S, W * k / (text.length * 0.55))`) so any copy up to
  `maxChars` fits in every format.
- **Blurred colour fields:** blur on an adjustment layer above the shapes.
  Effects on a shape layer are clipped to the shape's bounds.
- **3D children:** parent while 2D, then make the layer 3D, or it gets a
  counter-rotation and leaves the parent's plane.
- **After a range selector switches Units to index,** address its Start and
  End by matchName (`ADBE Text Index Start`, `ADBE Text Index End`). The
  percent versions still exist, hidden.
- **Unique layer names** within a template: every step finds layers by name.
- **Give every template a background layer** for its full length. Otherwise
  previews show a transparent (white) frame.
- **Name all copy neutrally.** Defaults are placeholders, never a real
  person's or brand's text.

**Validate:** `npm test` expands every template with its defaults in every
format and fails on unknown names, unknown tools, `NaN`, or leftover `{{`.
Then build it live (`ae_template build`) in a scratch project, look at the
contact sheet in each format, run `ae_proof` on each one, and fix what you
see. A template is not done until it proofs clean with the longest copy its
slots allow.
