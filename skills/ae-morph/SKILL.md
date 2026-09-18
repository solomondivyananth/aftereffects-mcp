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
3. **Match the counts.** If shape A has 4 vertices and B has 8, add
   vertices to A. Split each edge at its midpoint, with zero tangents on the
   new points so the silhouette doesn't change. Now both have 8.
4. **Match the first vertex.** Rotate B's arrays (vertices, inTangents and
   outTangents together) so its vertex 0 sits closest to A's vertex 0. Both
   paths must also wind the same way. If one runs clockwise and the other
   counter-clockwise, reverse one (reverse all three arrays, and swap in and
   out tangents).
5. **Keyframe the path** with both values, and ease it like any move:

   ```json
   ae_add_keyframes {"layer": "Icon", "path": ["Contents","Group 1","Contents","Path 1","Path"], "keys": [
     {"time": "0f",  "value": {"vertices": [...], "inTangents": [...], "outTangents": [...], "closed": true}, "ease": {"out": 20}},
     {"time": "18f", "value": {"vertices": [...], "inTangents": [...], "outTangents": [...], "closed": true}, "ease": {"in": 85}}]}
   ```

Shapes made of several parts (a logo with three pieces) morph part to part.
Give each part its own path, pair them up, and stagger them 2–3 frames (see
`ae-motion-principles`).

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

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Shape twists or spins mid-morph | first vertices don't line up | rotate B's arrays so vertex 0 matches A |
| Shape turns inside out or flips | opposite winding direction | reverse one path |
| Points bunch up and fold | different vertex counts | subdivide the shape with fewer vertices |
| Corners go round mid-morph | tangents interpolate too | zero the tangents at corners on both keys |
| Mushy timing | linear keys | ease like any move: out 15–20, in 80–90 |

## Check it

Morphs fail in the middle, not at the ends. `ae_review_motion` over the
morph with `frames` equal to its length in frames. `ae_render_frame` at the
halfway point shows twists and folds most clearly.
