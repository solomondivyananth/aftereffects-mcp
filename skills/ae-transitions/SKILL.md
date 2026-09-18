---
name: ae-transitions
description: Build transitions between shots and scenes in After Effects through the AE MCP Bridge - cuts on the beat, whip pans and zoom punches with motion blur, shape and mask wipes, luma and gradient wipes, iris, block and card wipes, light and glass wipes, match cuts, and precomp-based transitions, with verified effect and parameter names. Use when asked to transition, wipe, reveal, cut between scenes, or make scene changes feel smoother or punchier.
---

# Transitions

A transition is two layers overlapping for a few frames: the outgoing shot
(A) and the incoming shot (B). Everything below is a way to animate that
overlap. Keep transitions short (4–12 frames at 30 fps). Put them on beats,
using comp markers placed with `ae_markers`.

Set up the overlap first. Stack B above A with a few frames of overlap:

```json
ae_layer_action {"layers": ["Shot A", "Shot B"], "action": "sequence", "overlap": "8f"}
```

When A and B are whole scenes, precompose each (`ae_precompose`) so the
transition animates one layer per scene.

## The cut

Most transitions should be cuts. A cut on a beat, a cut on motion (the
movement carries across), or a cut on a match (same shape or position in both
shots) needs no effect at all. Before adding one, ask whether a clean cut on
the marker is better.

## Whip pan and zoom punch

The energetic ones, built from motion plus blur:

1. On both A and B, keyframe Position (whip) or Scale (punch) across the cut.
   A leaves fast (`ease {"out": 85}` on its last move), B arrives fast then
   settles (`ease {"in": 85}`).
2. Blur the fastest frames. Whip: `ADBE Motion Blur` (Directional Blur):
   Direction along the move, Blur Length 0 → 60–120 → 0 across the cut.
   Zoom: `ADBE Radial Blur` with Type Zoom, or `CC Radial Fast Blur` Amount.
3. Motion blur on the layers and the comp (see the `ae-effects` skill).
4. For a seamless whip, add `ADBE Tile` (Motion Tile) with Mirror Edges on,
   so the frame edges never show.

## Wipes with masks and shapes

Full control, any shape. Animate a mask on B that grows to reveal it:

```json
ae_masks {"layer": "Shot B", "action": "add", "mask": {"rect": [0, 0, 0, 1080], "feather": 40}}
ae_add_keyframes {"layer": "Shot B", "path": ["Masks","Mask 1","Mask Path"], "keys": [
  {"time": "0f", "value": {"vertices": [[0,0],[0,0],[0,1080],[0,1080]]}},
  {"time": "10f", "value": {"vertices": [[0,0],[1920,0],[1920,1080],[0,1080]]}, "ease": {"in": 85}}]}
```

A **shape wipe** (a brand shape or a circle that scales up to fill the frame)
is a shape layer used as a track matte:

```json
ae_shape {"name": "Wipe", "shape": "ellipse", "size": [10, 10], "fill": "#ffffff"}
ae_set_layer_props {"layer": "Shot B", "props": {"trackMatte": {"layer": "Wipe", "type": "alpha"}}}
```

Then scale Wipe from 0 to cover the frame (about 2300% for a 100 px circle
on 1920×1080) in 8–12 frames. Layered colour wipes (two or three coloured
shapes chasing each other 2 frames apart, ending on B) are the classic
motion-design transition.

## Transition effects

Put these on the outgoing layer A, above B. Every one has a Transition
Completion (or Completion) parameter: keyframe it 0 → 100.

| Effect | matchName | Parameters |
|---|---|---|
| Linear Wipe | `ADBE Linear Wipe` | Transition Completion, Wipe Angle, Feather |
| Radial Wipe | `ADBE Radial Wipe` | Transition Completion, Start Angle, Wipe Center, Wipe, Feather |
| Gradient Wipe | `ADBE Gradient Wipe` | Transition Completion, Transition Softness, Gradient Layer, Invert Gradient |
| Iris Wipe | `ADBE IRIS_WIPE` | Iris Center, Iris Points, Outer Radius, Inner Radius, Feather. Animate Outer Radius |
| Venetian Blinds | `ADBE Venetian Blinds` | Transition Completion, Direction, Width, Feather |
| Block Dissolve | `ADBE Block Dissolve` | Transition Completion, Block Width, Block Height, Feather |
| Card Wipe | `APC CardWipeCam` | Transition Completion, Transition Width, Back Layer, Rows, Columns, Flip Axis |
| CC Light Wipe | `CC Light Wipe` | Completion, Center, Intensity, Shape |
| CC Glass Wipe | `CC Glass Wipe` | Completion, Layer to Reveal, Gradient Layer, Softness |
| CC Grid Wipe | `CC Grid Wipe` | Completion, Center, Rotation, Tiles |
| CC Twister | `CC Twister` | Completion, Backside, Center, Axis |

```json
ae_apply_effect {"layer": "Shot A", "effect": "ADBE Linear Wipe", "params": {"Wipe Angle": 90, "Feather": 60}}
ae_add_keyframes {"layer": "Shot A", "path": ["Effects","Linear Wipe","Transition Completion"], "keys": [
  {"time": "0f", "value": 0, "ease": {"out": 20}}, {"time": "10f", "value": 100, "ease": {"in": 85}}]}
```

**Luma transitions:** a Gradient Wipe driven by a hidden layer (Fractal
Noise, a gradient ramp `ADBE Ramp`, or a texture) gives organic, ink-like
wipes. Set Gradient Layer to that layer and turn its visibility off
(`enabled: false`).

Layer-reference parameters (Gradient Layer, Layer to Reveal, Back Layer)
point at other layers. If `ae_apply_effect` can't set them from a name, set
them with `ae_run_jsx` (`prop.setValue(layerIndex)`), or ask the user to pick
the layer in the Effect Controls.

## Crossfades and dips

- **Crossfade:** B's Opacity 0 → 100 over the overlap. Use it rarely; it
  reads as soft and old-fashioned unless it's intentional.
- **Dip to colour:** a solid above both, Opacity 0 → 100 → 0 around the cut.
- **Flash cut:** a white solid on 1–2 frames with hold keys (`interp: "hold"`) exactly on the cut.

## Check it

Transitions live in a few frames, so look at every one:

```json
ae_review_motion {"start": "<cut time minus 6f>", "duration": "12f", "frames": 12}
```

Look for: a frame where neither shot shows, a mask edge visible at the start,
a hard edge where there should be feather, and whether the transition lands
on the beat. With a reference, compare it at native frame rate with the
`video-reference-compare` skill.
