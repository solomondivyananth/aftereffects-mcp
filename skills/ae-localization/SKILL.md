---
name: ae-localization
description: Localise an After Effects piece through the AE MCP Bridge - inventory every visible word (all precomps, keyed and expression-driven text, words baked into footage), a translation sheet with a width budget per layer read back as one batch, glossary and do-not-translate checks, fonts and glyph coverage for CJK, Arabic, Hebrew, Devanagari and Thai, right-to-left text, fitting each layer, counters and type-ons that keep their anchor, reading holds, one comp per language with its own precomps, and hand-over. Includes scripts. Use when asked to translate, localise, make language or market versions, or check a foreign-language version.
---

# Localisation

A language version is the same film with different words. Timing, motion
and hierarchy stay; only what the words force changes: a line rewraps, a box
grows, a hold lengthens. The work is **inventory → sheet → language comps →
apply → fit → check**.

## 1. Inventory every word

`scripts/loc-inventory.jsx` lists every text layer in every comp (precomps
included), one row per Source Text value (per key when Source Text is keyed),
with font, size, text box, time range, widest width and when, and the comps
that nest it. It changes nothing:

```json
ae_run_jsx {"file": "<skill dir>/scripts/loc-inventory.jsx"}
```

Save the `result` string as `inventory.json`. Without raw scripting, read
the same data with plain reads:
`ae_list_items {"kind": "comp"}`, `ae_comp_tree` per comp, and
`ae_layer_detail {"path": ["Text","Source Text"]}` per text layer.

What a script cannot read, and the inventory lists for a person:

| Where words hide | What it takes |
|---|---|
| Images, video, PSD/AI footage (screenshots, signs, UI) | render a frame (`ae_render_frame`) and look; a new asset per language, or a text layer rebuilt on top |
| Shape layers named `… Outlines` (Create Shapes from Text) | retype as a text layer, or redraw per language |
| Source Text with an expression | translate its source (a Controls text layer, a JSON file), not the layer |
| A hard-coded string inside an expression | move the string out to a text layer or data file first; baked-in copy can't be versioned |
| Essential Graphics controls (`essentialGraphics` per comp) | the editor fills them in Premiere; check the .mogrt in each language |

## 2. The translation sheet

```
node scripts/loc-sheet.js sheet inventory.json --langs DE,FR,JA --glossary glossary.csv --out sheet.csv
```

One row per string with `max_chars`, `width_px`, `budget_px` (box width, or
title-safe width for point text), font, glossary terms and notes; footage to
check by eye comes last. UTF-8 with a BOM, so Excel shows CJK and Arabic; ask
for it back as "CSV UTF-8".

- **Line breaks are `{br}`.** A break is part of the design (a two-line
  title), so the translator decides where it falls, not the wrap.
- **Glossary:** `term, dnt, DE, FR, …`. `dnt` = yes keeps product names,
  code, key labels and model ids exactly as written; other rows carry the
  approved translation per language. An approved term beats a fresh one.
- **Length budgets are planning numbers.** German and Finnish run 20–35 %
  longer than English, French and Spanish 15–30 %; Japanese and Chinese need
  fewer characters but each is a full em wide. Ask the translator for a
  shorter line before shrinking type.
- Use full locale codes: `de-DE` and `de-CH` (no ß), `pt-BR` and `pt-PT`,
  `zh-Hans` and `zh-Hant` (different fonts).

## 3. Language comps

`ae_duplicate_comp` copies only the top comp, so text inside a shared precomp
would change in every language at once. `scripts/loc-duplicate.jsx` copies the
master and every precomp under it that holds text, names them
`Master_16x9_DE`, `Title_DE`, repoints them at each other, files them in a
`DE` folder and leaves text-free precomps shared. One undo step:

```json
ae_run_jsx {"code": "$.global.locArgs = {master: 'Master_16x9', lang: 'DE'}; $.evalFile(new File('<skill dir>/scripts/loc-duplicate.jsx'))"}
```

Save the result as `dup-DE.json`. Its `expressionRefs` are text expressions
that name a comp with `comp("…")`: they still point at the source language.

Then check the translations and turn them into edits:

```
node scripts/loc-sheet.js apply inventory.json translated.csv --lang DE --map dup-DE.json --glossary glossary.csv --out batch-DE.json
```

Before anything touches the project it reports box text needing more lines
than the box holds (those lines don't render), point text likely over budget,
a changed `{br}` count, changed numbers, missing do-not-translate terms,
glossary misses and what needs a person, and exits 1 on errors. Run `batch-DE.json` as one `ae_batch`; keyed Source
Text gets `time`, so each key keeps its moment.

Setting text gives every character the first character's style. Re-apply a
coloured or bold word with `ae_text` `ranges` at its new indices.

### One master, many languages

For review, one master can switch language from data (`ae-data-driven`).
`loc-sheet.js strings … --langs EN,DE,JA --source EN` writes
`strings.json`, keyed `Comp/Layer`. Import it, add a Slider `Language` on a
Controls null in the master, and on each Source Text:

```js
var langs = ["EN", "DE", "JA"];
var i = Math.round(comp("Master_16x9").layer("Controls").effect("Language")("Slider"));
var s = footage("strings.json").sourceData[langs[i]];
var t = s ? s[thisComp.name + "/" + thisLayer.name] : null;
t ? t : value
```

Layer names must be unique per comp. The queue renders only the current
language, so deliver from per-language comps; this rig is for review.

## 4. Fonts and scripts

A font that lacks a glyph shows a box (tofu) or borrows the glyph from another
font, and nothing reports it. Check every language:

1. Find a family that covers the script: `ae_catalog {"kind": "fonts",
   "query": "Noto Sans"}` (After Effects 2024+). Match the source's weight,
   width and role.
2. Render the widest frame; a borrowed glyph shows as the wrong weight.
3. In After Effects 24+, ask the font directly. `TextDocument.fontObject`, <!--verify-->
   `FontObject.isSubstitute` and `FontObject.hasGlyphsFor(text)` <!--verify-->
   are the calls; this checks the first character's font per layer:

```jsx
(function () {
    var out = [], i, j, c, L, td, fo;
    for (i = 1; i <= app.project.numItems; i++) {
        c = app.project.item(i);
        if (!(c instanceof CompItem) || !/_DE$/.test(c.name)) { continue; }
        for (j = 1; j <= c.numLayers; j++) {
            L = c.layer(j);
            if (!(L instanceof TextLayer)) { continue; }
            td = L.property("ADBE Text Properties").property("ADBE Text Document").value;
            fo = td.fontObject;
            out.push(c.name + " / " + L.name + ": " + td.font + (fo.isSubstitute ? " SUBSTITUTED" : "") +
                (fo.hasGlyphsFor(td.text.replace(/[\r\n]/g, "")) ? "" : " MISSING GLYPHS"));
        }
    }
    return out.join("\n");
})()
```

| Script | Families to look for | Watch |
|---|---|---|
| Japanese, Chinese, Korean | Noto Sans CJK / Source Han Sans (JP, SC, TC, KR), Hiragino, Yu Gothic, PingFang, Microsoft YaHei, Apple SD Gothic Neo, Malgun Gothic | JP, SC, TC and KR draw the same code point differently: pick the regional cut |
| Arabic | Noto Sans / Naskh Arabic, Geeza Pro, Adobe Arabic | right to left, joined letters |
| Hebrew | Noto Sans Hebrew, Arial Hebrew | right to left |
| Devanagari (Hindi, Marathi) | Noto Sans Devanagari, Kohinoor Devanagari, Nirmala UI | conjuncts, marks above the headline |
| Thai | Noto Sans Thai, Thonburi, Leelawadee UI | no spaces between words, stacked marks |
| Vietnamese, Polish, Czech, Turkish | check the Latin font itself | stacked accents, ł ě ğ ı |

- **Right to left** needs the South Asian and Middle Eastern text engine, <!--verify-->
  set by hand in File ▸ Project Settings. <!--verify-->
  Paragraph direction is `TextDocument.direction` <!--verify-->
  (`ParagraphDirection.DIRECTION_RIGHT_TO_LEFT`), <!--verify-->
  the engine per layer `TextDocument.composerEngine`, <!--verify-->
  set through `ae_run_jsx`. Right-justify, check how
  Latin words and digits sit inside the line, and ask before mirroring the
  layout (slide-ins, progress bars, arrows): that is a design call.
- **No per-character motion on joined scripts.** A per-letter scale or
  position animator breaks Arabic joins, Devanagari conjuncts and Thai marks.
  Set the selector's Based On to words or lines; Thai has no spaces, so use
  lines or break points from the translator.
- **CJK is not Latin with other letters.** No caps tracking, no tight
  display tracking, no allCaps, no italics (use weight or colour). Keep
  punctuation full-width; `tsume` tightens it (an `ae_text` style key). <!--verify-->
- **Tall marks need leading.** Thai, Vietnamese, Devanagari and Arabic
  reach above and below Latin caps and descenders: raise leading and check
  masks, mattes and text boxes aren't clipping them.
- **Fit each layer, never a whole language.** "German at 85 %" shrinks
  lines that fit and breaks the hierarchy.

## 5. Re-typesetting

**Box text** wraps, and its width is the budget. Lines past the box vanish
silently: grow the box (`ae_text` style `boxTextSize`) before shrinking type.

**Shrink to fit** only when rewording can't, on Scale, measured on the
finished line: a layer marker where the line is complete, else the last
frame. Never measure at `time` on a type-on: before the first character the
bounds are 0 and the layer jumps.

```js
var maxW = 1600, maxH = 300;
var tFull = marker.numKeys ? marker.key(1).time : outPoint - thisComp.frameDuration;
var r = sourceRectAtTime(tFull, false);
var s = 1;
if (r.width > maxW) s = Math.min(s, maxW / r.width);
if (r.height > maxH) s = Math.min(s, maxH / r.height);
mul(value, s)
```

Shrinking scales around the anchor, so pin it to the side the text is set
from (0 left, 0.5 centre, 1 right; right for RTL), on Anchor Point. Adding
it moves the layer once; put Position back with `ae_set_property`:

```js
var tFull = marker.numKeys ? marker.key(1).time : outPoint - thisComp.frameDuration;
var r = sourceRectAtTime(tFull, false);
var side = 0;
[r.left + r.width * side, r.top]
```

Past about 80 %, reword or rewrap instead: hierarchy breaks and
`text-small` follows.

**Type-ons** reveal with a Range Selector on Opacity (`ae-typography`):
hidden characters keep their space, so a centred line never moves. If it
must type through Source Text, left-justify it and use the anchor above with
`side = 0.5`, so the finished line lands centred.

**Counters** keep the number as its own layer, centred, with a font whose
figures are tabular, and prefix and suffix as separate layers that follow its
edges. Currency and percent change sides and spacing by language
(`5 €`, `50 %`, `$5`), so each language fills only the layers it uses.

```js
var n = Math.round(thisComp.layer("Controls").effect("Count")("Slider"));
var sep = ".";
String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep)
```

`sep`: `,` English, `.` German, narrow no-break space French; Indian
grouping (12,34,567) needs its own pattern. The prefix is
right-justified and its Position follows the number's left edge; the suffix
is the mirror, with `r.left + r.width` and `+ gap`:

```js
var n = thisComp.layer("Count");
var r = n.sourceRectAtTime(time, false);
var edge = n.toComp([r.left, 0]);
var gap = 16;
[edge[0] - gap, value[1]]
```

**Holds grow with the text:** about 0.5 s to find a line, then ~15
characters a second in Latin scripts, 7–10 in Chinese and Japanese. Lengthen
the hold, not the moves; if a cut is locked to music, ask for shorter copy. `ae_proof` flags `read-time`.

## 6. Render and hand over

- Name by language: `Master_16x9_DE`, outputs
  `Project_Master_16x9_DE_1920x1080_v003.mov`. Queue them all with
  `ae_render_queue {"action": "add", …}` per language, then
  `{"action": "queue_in_ame"}` (`ae-deliver`).
- **Reduce Project deletes comps that only an expression reads**
  (`comp("…")`; check `footage("…")` items too). Save a copy, then name them
  in `items` of `ae_item_action {"action": "reduce"}`.
- `ae_item_action {"action": "missing"}` before hand-over. Collect Files
  (File ▸ Dependencies ▸ Collect Files) is a dialog: ask the user to run it.
- Fonts are not collected. List each language's families from the
  inventory, check them with `ae_catalog`; bundle only what licences allow.

## 7. Check every language

1. Render each row's comp copy at its `widestAt` (that comp's own time;
   `usedIn` gives the offset into the parent): `ae_render_frame {"comp":
   "Title_DE", "times": […]}`.
2. `ae_proof` on the language master and each text precomp: `text-overflow`,
   `clipped`, `safe-area`, `text-small`, `read-time`, `expression-error`.
3. `ae_find_animation` on the copies: no `expressionError`, and no
   expression still reading the source language's comp.
4. Compare with the master at the same times: only what the words forced
   differs.
5. A native speaker reads the rendered frames and watches it in full.
   Breaks, hyphenation, tone and legal copy are theirs to approve. Report
   what they have and haven't seen.
