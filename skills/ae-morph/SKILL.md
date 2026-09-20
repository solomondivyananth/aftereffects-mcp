---
name: ae-morph
description: Morph shapes, masks, letters and artwork in After Effects through the AE MCP Bridge - path-to-path shape morphs with matched vertex counts and first vertices, mask morphs, text-to-shape morphs, gooey metaball merges, and image morphs with Reshape, plus how to keep them from twisting or collapsing. Use when asked to morph, transform one shape into another, turn an icon into a logo, blob or liquid transitions, or when a shape animation twists, flips or folds in on itself.
---

# Morph

After Effects morphs a path by moving each vertex of one shape to the
matching vertex of the next. Almost every bad morph has one of two causes:
the shapes have **different vertex counts**, or their **first vertices sit
in different places**. Fix those two things and most morphs just work.

## Shape-to-shape morph

1. **Both shapes must be Bezier paths.** Rectangles, ellipses and stars are
   parametric and can't morph into each other. Author the paths as vertices
   (`ae_shape {"shape": "path", "path": {...}}`), or convert a parametric
   shape: select its path property with a raw script, then run
   `ae_menu_command {"command": "Convert To Bezier Path"}`.
2. **Read both shapes' vertices:**

   ```json
   ae_layer_detail {"layer": "Icon", "path": ["Contents","Group 1","Contents","Path 1","Path"]}
   ```

   The value is `{vertices, inTangents, outTangents, closed}`.
3. **Match the counts** (see the maths below). If shape A has 4 vertices and
   B has 8, subdivide A's edges until both have 8. Subdividing at the
   midpoint of a curve does not change the silhouette at all, so this is
   free.
4. **Match the first vertex and the winding** (maths below). Rotate B's
   arrays so its vertex 0 sits nearest A's vertex 0, and reverse one path if
   they wind opposite ways.
5. **Keyframe the path** with both values, and ease it like any move:

   ```json
   ae_add_keyframes {"layer": "Icon", "path": ["Contents","Group 1","Contents","Path 1","Path"], "keys": [
     {"time": "0f",  "value": {"vertices": [...], "inTangents": [...], "outTangents": [...], "closed": true}, "ease": {"out": 20}},
     {"time": "18f", "value": {"vertices": [...], "inTangents": [...], "outTangents": [...], "closed": true}, "ease": {"in": 85}}]}
   ```

Shapes made of several parts (a logo with three pieces) morph part to part.
Give each part its own path, pair them up, and stagger them 2–3 frames (see
`ae-motion-principles`).

### The maths, so you can do it rather than eyeball it

A path value is `{vertices, inTangents, outTangents, closed}`, and **tangents
are relative to their own vertex** — that is what makes these formulas short.

**Subdivide one edge at its midpoint.** For an edge from vertex `P0` (with
`outTangents[i] = t0`) to vertex `P1` (with `inTangents[i+1] = t1`), take the
absolute control points `C0 = P0 + t0` and `C1 = P1 + t1`, then split at
t = 0.5 (de Casteljau):

```
A = (P0 + C0) / 2      B = (C0 + C1) / 2      C = (C1 + P1) / 2
D = (A + B) / 2        E = (B + C) / 2        M = (D + E) / 2
```

`M` is the new vertex. The tangents become `P0.out = A − P0`,
`M.in = D − M`, `M.out = E − M`, `P1.in = C − P1`. The curve is identical to
the one you started with; it just has one more point on it.

Subdivide the **longest** edges first, so the added points spread evenly
around the shape rather than piling into one corner. Repeat until the counts
match. Keep the total under about 64 points: beyond that nobody can see the
difference and every later edit is slower.

**Which way does it wind?** Sum over the edges:

```
S = Σ (x[i+1] − x[i]) × (y[i+1] + y[i])
```

After Effects' y runs down the screen, so `S > 0` is clockwise as seen.
If A and B disagree, reverse one.

**Reverse a path** without moving its start point: keep vertex 0, reverse the
rest (`[v0, v(n−1), v(n−2), …, v1]`), do the same to both tangent arrays, and
swap `inTangents` with `outTangents`.

**Find the best rotation.** For every offset `k` from 0 to n−1, score

```
score(k) = Σ | A[i] − B[(i + k) mod n] |²
```

and rotate B by the `k` with the lowest score. That single step removes most
"why does it spin?" morphs. Rotate all three arrays together.

All of this is arithmetic on values `ae_layer_detail` already gave you —
compute it yourself and write the finished path with `ae_add_keyframes`. Use
`ae_run_jsx` only if you would rather have After Effects do the sums.

## Masks

Mask paths morph exactly like shape paths, keyed on
`["Masks","Mask 1","Mask Path"]` with the same value format. `ae_masks` can
set one shape at a given `time`. For a wipe that changes shape as it grows,
key the mask path a few times along the way.

## Letters and logos

- **Text to shapes:** `ae_menu_command {"command": "Create Shapes from Text", "layer": "Title"}`
  makes a shape layer with one group per character. Each letter is now a
  path you can morph.
- **Illustrator artwork:** import with `ae_import_file`, add the layer, then
  `ae_menu_command {"command": "Create Shapes from Vector Layer", "layer": "Logo"}`.
- **Word to word:** morph letter to letter where the counts line up.
  Otherwise scale or fade the extra letters out while the matched ones morph.
  One clean morph reads better than twenty tangled ones.

## When a path morph is the wrong tool

| Want | Better than morphing |
|---|---|
| A line or outline that draws itself on | Trim Paths (`ae_shape {"trim": {...}}`), keyframe End 0 → 100 |
| A shape that grows fatter or thinner | the Offset Paths operator, animating Amount |
| Organic wobble on an existing shape | the Wiggle Paths operator — it is a path operator, not an expression, so it stays editable |
| Points pulled in or pushed out (a star becoming a blob) | the Pucker & Bloat operator |
| Rounded corners appearing | the Round Corners operator |
| An icon becoming a different icon with a different point count | crossfade the two at their smallest scale, where nobody can tell |

Add a path operator with `ae_add_property` under the group's `Contents` and
read the returned property names back from that call — the names differ
between versions, so never guess them.

## Gooey and liquid merges

For blobs that merge and split like metaballs, don't morph paths:

1. Put the shapes in a precomp (`ae_precompose`).
2. On the precomp layer, add `ADBE Gaussian Blur 2` (Blurriness 20–40), then
   `ADBE Simple Choker` (Choke Matte, negative to fatten) or
   `ADBE Easy Levels2` (Levels) on the Alpha channel to sharpen the blurred
   edge back up.
3. Animate the shapes moving together and apart. Where they overlap, the
   blurred alpha merges into one smooth blob.

## Morphing images

For footage or photos, `ADBE RESHAPE` (Reshape) warps one masked region into
another. It needs three masks (source, destination, boundary) set up in the
Effect Controls, so it's partly manual. Ask the user to assign the masks.

A cheaper cheat that reads as a morph: crossfade the two images over 6–10
frames while both scale and blur slightly, with `ADBE Turbulent Displace`
animating Amount 0 → 30 → 0 across the change.

## Timing a morph

- 12–20 frames at 30 fps. Under 10 the shapes read as a flicker; over 25 the
  audience watches the vertices travel.
- Ease it like any move: `{out: 15–20}` then `{in: 80–90}`. A linear morph
  looks like a computer doing geometry.
- **Hide the middle.** The midpoint is where a morph looks least like
  anything, so give it something else to watch: a slight scale (100 → 106 →
  100), a 5–8° rotation, a blur that peaks and clears, or a colour change
  that lands on the new shape's colour just before the shape settles.
- If both shapes are recognisable and the morph still reads as mush, morph
  fewer things: hold one part still and morph only the part that must change.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Shape twists or spins mid-morph | first vertices don't line up | rotate B's arrays by the best-scoring offset |
| Shape turns inside out or flips | opposite winding direction | reverse one path |
| Points bunch up and fold | different vertex counts | subdivide the shape with fewer vertices, longest edges first |
| Corners go round mid-morph | tangents interpolate too | zero the tangents at corners on both keys |
| One key morphs, the next jumps | the two keys have different `closed` flags, or different counts | every key of a path must have the same point count and closure |
| The shape drifts across the frame | you morphed the path and moved the group transform at once | morph the path, or move the layer — not both in the same frames |
| Letters morph but their holes don't | counters (the hole in an "o") are separate paths in the group | pair every path in the group, not just the outer one |
| Mushy timing | linear keys | ease like any move: out 15–20, in 80–90 |

## Check it

Morphs fail in the middle, not at the ends. `ae_review_motion` over the
morph with `frames` equal to its length in frames, so you see every frame.
`ae_render_frame` at the halfway point shows twists and folds most clearly —
render 40%, 50% and 60% together and the fold will be obvious in one of them.

Then ask whether both ends still read: `ae_render_frame` on the last frame
before the morph and the first frame after it. A morph that arrives at a
shape nobody recognises has failed even if every frame in between was smooth.
