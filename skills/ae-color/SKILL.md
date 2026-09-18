---
name: ae-color
description: Colour in After Effects through the AE MCP Bridge - grading with Lumetri Color on an adjustment layer (white balance, exposure, contrast, saturation, vibrance, faded film, vignette), looks and LUTs without freezing the app, duotones and brand tints, matching shots and a brand palette, selective colour, broadcast-safe limits, and checking a grade with rendered frames. Verified effect and parameter names. Use when asked to grade, colour correct, match shots, apply a look or LUT, recolour to brand colours, make it warmer, cooler, moodier or filmic, or fix washed-out or clipped footage.
---

# Colour

Grade on an **adjustment layer** above the shots, not on each shot. One
layer changes everything under it, and turning it off (`enabled: false`)
gives an instant before and after.

```json
ae_create_layer {"kind": "adjustment", "options": {"name": "Grade"}}
ae_apply_effect {"layer": "Grade", "effect": "ADBE Lumetri"}
```

## Lumetri Color

Its controls are addressed directly under the effect. The first control with
a name is the one in Basic Correction:

```json
ae_set_property {"layer": "Grade", "path": ["Effects","Lumetri Color","Temperature"], "value": 12}
ae_set_property {"layer": "Grade", "path": ["Effects","Lumetri Color","Exposure"], "value": 0.3}
```

| Control | Range | Does |
|---|---|---|
| Temperature | −100 … 100 | cooler (−) or warmer (+) |
| Tint | −100 … 100 | green (−) or magenta (+) |
| Exposure | stops, about −5 … 5 | overall brightness |
| Contrast | −100 … 100 | |
| Highlights · Shadows · Whites · Blacks | −100 … 100 | tonal ranges |
| Saturation | 0 … 200 (100 = unchanged) | all colours |
| Vibrance | −100 … 100 | the less-saturated colours only, so skin stays natural |
| Faded Film | 0 … 100 | lifted blacks, the filmic "matte" look |
| Amount | −5 … 5 | vignette (negative darkens the edges), with Midpoint, Roundness, Feather |

**A grading order that works:**
1. Balance (Temperature, Tint) until whites are white.
2. Exposure, then Whites and Blacks to set the range: nothing important
   clipped, true blacks where there should be.
3. Contrast, then Highlights and Shadows for shape.
4. Colour: Vibrance first, Saturation only if needed.
5. The look: Faded Film, a split tone, a vignette.

Change one thing at a time, and look after each step
(`ae_render_frame` at 2–3 representative moments).

## Looks and LUTs without a frozen app

**Apply Color LUT** (`ADBE Apply Color LUT2`) opens a file picker the moment
it's applied. That dialog freezes After Effects until someone clicks it, so
`ae_apply_effect` refuses it unless `allowDialog: true` is passed with a
person at the machine. Instead:

- use Lumetri's own Look and Input LUT menus (the user picks one in the
  Effect Controls; ask them), or
- apply an **animation preset** that already contains the LUT
  (`ae_apply_preset`). Make it once, by hand: apply the LUT, then Animation ▸
  Save Animation Preset.

## Brand colour and stylised looks

| Look | Effect (matchName) | Key parameters |
|---|---|---|
| Duotone in brand colours | `ADBE Tint` | Map Black To, Map White To, Amount to Tint |
| Three-tone | `ADBE Tritone` | highlights, midtones, shadows colours |
| Five-zone toning | `CC Toner` | Highlights, Brights, Midtones, Darktones, Shadows |
| Black & white with channel control | `ADBE Black&White` | Reds, Yellows, Greens, Cyans, Blues, Magentas, Tint Color |
| Keep one colour, grey the rest | `ADBE Leave Color` | Amount to Decolor, Color To Leave, Tolerance, Edge Softness |
| Swap one colour for another | `ADBE Change To Color` | From, To, Tolerance, Softness |
| Warm or cool filter | `ADBE PhotoFilterPS` | Filter, Color, Density, Preserve Luminosity |
| Gentle saturation | `ADBE Vibrance` | Vibrance, Saturation |

```json
ae_apply_effect {"layer": "Grade", "effect": "ADBE Tint",
                 "params": {"Map Black To": "#1b1640", "Map White To": "#f3eaff", "Amount to Tint": 60}}
```

## Precise correction

| Need | Effect | Key parameters |
|---|---|---|
| Exposure in stops, per channel | `ADBE Exposure2` | Exposure, Offset, Gamma Correction (and per channel) |
| Levels | `ADBE Easy Levels2` | Input Black, Input White, Gamma, Output Black, Output White |
| Levels per channel | `ADBE Pro Levels2` | Red/Green/Blue Input Black, Input White, Gamma… |
| Curves | `ADBE CurvesCustom` | the curve is drawn in the Effect Controls; use Levels or Lumetri to script it |
| Shadow and highlight recovery | `ADBE ShadowHighlight` | Shadow Amount, Highlight Amount |
| Colour balance by range | `ADBE Color Balance 2` | Shadow/Midtone/Highlight Red, Green, Blue Balance |
| Channel mixing | `ADBE CHANNEL MIXER` | Red-Red … Blue-Const, Monochrome |
| Selective colour | `ADBE SelectiveColor` | Colors (the range), then Cyan, Magenta, Yellow, Black |
| Hue shift or colourize | `ADBE HUE SATURATION` | Master Hue, Master Saturation, Master Lightness, Colorize |

## Matching shots

1. Pick the **hero shot** and grade it first.
2. Render a frame of the hero and of the shot to match, at the same kind of
   moment (`ae_render_frame`). Compare whites, blacks, skin and overall
   colour temperature.
3. On the shot being matched (its own effect, not the shared adjustment
   layer), correct in this order: black and white points (Levels or
   Lumetri Whites/Blacks), then balance (Temperature, Tint, or
   `ADBE Color Balance 2`), then saturation.
4. Render both frames again and compare. The `video-reference-compare`
   skill's `--diff` row shows remaining differences brightly.

To match a brand palette, sample the brand colours (as hex from the brand
guide) and put them in `ADBE Tint` or `ADBE Tritone`, or on the Controls null
as colour controls that every element reads (see `ae-templates`).

## Broadcast and delivery

- `ADBE DigitalVideoLimiter` (Video Limiter: Clip Level) or
  `ADBE Broadcast Colors` keeps levels legal for broadcast. Put it on the
  topmost adjustment layer.
- OCIO transforms (`ADBE OCIO Color Space Transform`,
  `ADBE OCIO Display Transform`) are for colour-managed pipelines. Only use
  them when the project uses OCIO, and ask first.

## Check it

Colour can't be judged from numbers. After each change, `ae_render_frame` at
full resolution (`downscale: 1`) at 2–3 moments, including the brightest and
darkest shots, and describe what you see: "whites now neutral, shadows
slightly blue, skin natural". Before and after: toggle the Grade layer with
`ae_set_layer_props {"enabled": false}` and render the same frame.
