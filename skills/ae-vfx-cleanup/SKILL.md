---
name: ae-vfx-cleanup
description: Paint-out, cleanup and compositing in After Effects through the AE MCP Bridge - removing objects, rigs, wires, marks and lettering from footage with donor patches, tracked repairs and Content-Aware Fill set-ups, replacing signs, checking a key, and seating a foreground in a plate (light match, contact shadow, light wrap, atmosphere, defocus, motion blur, grain), plus before/after review and a cross-platform script that finds frozen or repeated frames in a render. Says plainly what needs a person (tracker, Mocha, Roto Brush, the fill button, paint). Use when asked to remove, paint out, clean up or replace something in a shot, fix a key or a composite, or make an element sit in live-action footage.
---

# VFX cleanup and compositing

Cleanup is a patch of real pixels laid over the problem, moving with the
surface under it. Keep three things apart in every comp: the **Plate** (the
original, never edited), the **Repair** (the patch, and only the patch), and
the **Holdout** (anything in front that must survive, restored on top).

Build in a duplicate: `ae_duplicate_comp {"comp": "Shot", "name": "Shot CLEAN"}`.

## Classify the shot first

Two questions decide it, not size: is the background behind the target
ever seen, and what in front of it must survive?

| Background behind the target | In front of it | Approach |
|---|---|---|
| Seen in another frame (the object moves, or the camera does) | nothing | donor patch, time-offset |
| Seen next to it, same surface, locked camera | nothing | donor patch, space-offset |
| A flat surface, camera moving | nothing, or a rigid hand or prop | tracked repair |
| Flat surface with lettering | anything | clean the surface, then tracked text |
| Never seen, and textured (grass, gravel, brick) | nothing big | Content-Aware Fill, set up by the agent |
| Never seen, and it's a face, hair, a deforming surface, parallax | anything | say so; this is reconstruction, not cleanup |

Before building anything, render the target at its first, worst and last
frames: `ae_render_frame {"times": [1.0, 2.4, 3.8], "downscale": 1}`.

## Donor patch

The clean pixels already exist, in another frame or another place in the shot.

```json
ae_layer_action {"layer": "Plate", "action": "duplicate", "name": "Repair"}
ae_set_layer_props {"layer": "Repair", "props": {"startTime": -1.2}}
ae_masks {"layer": "Repair", "action": "add", "mask": {"rect": [880, 410, 160, 220], "feather": 6, "mode": "add"}}
```

`startTime: -1.2` shows the plate 1.2 s later under the same frame: pick an
offset where the object has moved clear. For a clean patch from beside the
target, move the Repair layer's Position by the offset instead and put the
mask back over the target. For a still donor, `freeze_frame` the duplicate at
the clean time.

- **Mask the smallest area that covers the target and its blur and shadow.**
  The edge goes where Plate and Repair are the *same material*.
- **Feather only the edge of a correct patch** (2–8 px at 1080). A wide
  feather over a wrong patch shows up as a smudge that moves.
- Donor frame brighter? Levels or Curves on the Repair, never the Plate. <!--verify-->
- A repeated landmark, frozen grain or a sliding patch fails. Check first,
  middle, last and the fastest camera move.

## Tracked repair

When the surface moves, the patch must follow the surface — **track the
surface, not the hardware**. The tracker isn't scriptable. Ask the user:

> Select the Plate layer. Window ▸ Tracker ▸ **Track Motion**. Track Type
> **Perspective corner pin** for a flat surface, **Transform** for a small
> patch. Put the four points on high-contrast corners *on the surface*,
> away from the object and anything that crosses it. Press **Analyze
> forward** (and backward from the first frame). Don't press Apply. <!--verify-->

Then the agent reads the track and builds everything else. Check it first —
low confidence means a point lost its feature:

```jsx
var c = app.project.activeItem, L = c.layer("Plate");
var tp = L.property("Motion Trackers").property("Tracker 1").property("Track Point 1"); // <!--verify-->
var conf = tp.property("Confidence"), bad = [], i; // <!--verify-->
for (i = 1; i <= conf.numKeys; i++) { if (conf.keyValue(i) < 0.8) { bad.push(Math.round(conf.keyTime(i) / c.frameDuration)); } }
"keys " + conf.numKeys + ", low-confidence frames: " + bad.join(",");
```

Run it with `ae_run_jsx {"code": "…"}`, or read the points with
`ae_layer_detail {"layer": "Plate", "path": ["Motion Trackers","Tracker 1","Track Point 1"]}`. <!--verify-->
Send low-confidence frames back to the user to re-place that point.

**Four points → Corner Pin.** For a precomp whose frame *is* the surface (a
squared-up clean still of it, or sign text): `ae_apply_effect {"effect": "Corner Pin"}`, <!--verify-->
then on `["Effects","Corner Pin","Upper Left"]` (and Upper Right, Lower Left, <!--verify-->
Lower Right with Track Points 2–4):

```js
var plate = thisComp.layer("Plate");
fromComp(plate.toComp(plate.motionTracker("Tracker 1")("Track Point 1").attachPoint));
// <!--verify-->
```

**One point → a null.** For a patch that only translates, create a null and
put this on its Position, then parent the Repair to it:

```js
var plate = thisComp.layer("Plate");
plate.toComp(plate.motionTracker("Tracker 1")("Track Point 1").attachPoint);
// <!--verify-->
```

A frozen donor frame that must follow the surface from the frame it was taken
at (here 2.0 s) — Position on the Repair:

```js
var plate = thisComp.layer("Plate");
var tp = plate.motionTracker("Tracker 1")("Track Point 1").attachPoint;
var ref = 2.0;
value + plate.toComp(tp) - plate.toComp(tp.valueAtTime(ref), ref);
// <!--verify-->
```

**Holdout.** If a hand or a prop crosses the repair, duplicate the Plate to
the top, name it Holdout, and mask it to the crossing object with keyed mask
paths (`ae_masks` with `time`), or ask the user for a Roto Brush matte. The
Repair sits between Plate and Holdout; it never paints over the hand.

## Signs and lettering

1. Clean the surface first, with a donor patch or tracked repair. Look at it
   with the new text off: old strokes must not survive under the new ones.
2. Build the text in a precomp the size of the sign face: `ae_create_comp`,
   `ae_text`, then `ae_create_layer {"kind": "precomp", "options": {"source": "Sign Text"}}`.
3. Corner-pin the precomp layer with the four-point expressions above.
4. Match it to the plate, in this order: blur (Gaussian Blur 0.5–1.5, <!--verify-->
   more if the plate's edges are soft), the surface's light (a Levels or Curves <!--verify-->
   gradient from the sign's shading), motion blur if the camera moves, grain
   last (below). The text should never be sharper than the plate's edges.

## Wires and rigs

Split the wire by what's behind it.

| Wire is over | Fix |
|---|---|
| a key or clean backing | it leaves with the key; mask it out of the matte |
| a static, plain background | donor patch from the next frames, or Wire Removal if `ae_catalog {"kind": "effects", "query": "wire"}` finds it — short straight segments only <!--verify--> |
| clothing, skin, a moving surface | a thin tracked strip patch from the same material, a few pixels wide |

**Never freeze a large body region to remove a thin wire.** It stops
breathing with the fabric and reads instantly. Remove the rig's shadow
as its own job; keep the body's own contact shadow.

## Content-Aware Fill

The agent does the setup; the **Generate Fill Layer** button is the user's. <!--verify-->

```json
ae_layer_action {"layer": "Plate", "action": "duplicate", "name": "Fill Source"}
ae_masks {"layer": "Fill Source", "action": "add", "mask": {"rect": [880, 410, 160, 220], "mode": "subtract", "expansion": 8}}
ae_set_comp_settings {"settings": {"workAreaStart": 0.5, "workAreaDuration": 3.5}}
```

Key the mask path to follow the object (`ae_masks` with `time`, or the track
data). **The work area limits which frames the fill can sample**, not only
which it renders: give it the frames where the background shows. Then ask:

> Window ▸ Content-Aware Fill. Fill Method **Object** for a moving thing,
> **Surface** for a flat wall or road, **Edge Blend** for plain areas. Range
> **Work Area**. Lighting Correction off unless the light changes. Click
> **Generate Fill Layer**. <!--verify-->

Render its hardest frame before trusting the rest. If it invents folds or
edges, give it cleaner frames or a reference frame; don't just rerun it.

## Keying handoff

- **Straight or premultiplied?** Look at a soft edge over black and over
  white. A dark fringe on white and a clean edge on black means premultiplied
  data labelled straight: `ae_item_action {"action": "interpret", "item": "FG", "settings": {"alpha": "premultiplied"}}`.
- **Check over black, white, mid-grey and the real plate**, at the fastest
  motion and at a hair edge. Put a solid under it and render all four.
- **Despill is its own branch.** Keylight (1.2) Despill Bias, or Advanced <!--verify-->
  Spill Suppressor after the key; never desaturate the whole edge. <!--verify-->
- **Clip Black / Clip White only fill holes** (backing left in, the subject <!--verify-->
  left see-through). Hair and motion blur are grey in the matte on purpose.
- **Never fix a fringe with opacity, a choke or a blend mode.** Fix it where
  it came from: the alpha interpretation, the spill, or the key.
- Unpremultiplying doesn't remove an old background baked into the edge; it
  only divides by alpha.

## Seating a foreground in a plate

Work down this ladder, and stop at each rung until it matches.

1. **Light direction and colour.** Read the key direction from the plate's
   shadows. If the element is lit from the other side, no grade fixes it. Match
   blacks, mids and highlights to a similar surface in the plate (`ae-color`).
2. **Contact shadow from the alpha.** Duplicate the element, name it Shadow,
   put it under the element; Fill (Color: dark sampled from the plate's <!--verify-->
   shadows), Transform (Skew, Skew Axis, Scale Height) to lay it on the ground <!--verify-->
   away from the light, Gaussian Blur (Blurriness 10–40), blending `multiply`, <!--verify-->
   opacity 40–70. Sharpest and darkest at the contact; it lifts and softens
   when the object leaves the ground.
3. **Light wrap, inside the silhouette only.** A precomp "Wrap Matte": the element
   (switched off) and a white solid with three effects: Set Matte (Take Matte From Layer: the element, <!--verify-->
   Use For Matte: Alpha Channel, Invert Matte on), Gaussian Blur 10–30, Set <!--verify-->
   Matte again (not inverted). That leaves a band just inside the edge. Above
   the element, a blurred copy of the background precomp with `trackMatte`
   `{"layer": "Wrap Matte", "type": "alpha"}`, blending `screen`, opacity 30–60.
4. **Atmosphere.** Only if the plate has haze on surfaces at the same depth:
   lift the element's blacks toward the haze colour (Levels Output Black). <!--verify-->
5. **Defocus.** Match the sharpness of plate detail at the same depth. Camera
   Lens Blur's Blur Focal Distance is a **value in the blur map** (0–255), not <!--verify-->
   metres: the map value that stays sharp.
6. **Motion blur.** Comp motion blur only for motion the layer transforms add.
   Never on footage that already has blur baked in. Shutter angle from the
   camera: `360 × exposure × fps` — 1/50 s at 25 fps is 180°, 1/100 s at 25 fps
   is 90°. Pixel Motion Blur only when footage lacks blur it should have. <!--verify-->
7. **Grain last, at final scale.** Add Grain or Match Grain (Noise Source <!--verify-->
   Layer: the plate) on the Repair or the element only. Match Grain adds noise,
   it can't remove any, and it works at 8 and 16 bpc only (it clips a 32 bpc
   chain).

## What needs a person

| Job | The user does | The agent does before | The agent does after |
|---|---|---|---|
| Point / planar tracking | Tracker ▸ Track Motion ▸ Analyze (above) | picks the surface features, sets the work area | reads confidence, drives Corner Pin or a null |
| Mocha AE planar track | Mocha AE effect ▸ Track in Mocha; back in AE, Create Track Data, Export Option Corner Pin, Apply Export <!--verify--> | names the surface to track, not the hardware | reads the Corner Pin keys, checks for drift |
| Content-Aware Fill | Generate Fill Layer | duplicate, subtract mask, work area | checks the hardest frame, masks the fill layer |
| Roto Brush / Object Matte | strokes and propagates, then Freeze <!--verify--> | marks the frames where the outline changes | uses the matte as the Holdout, checks edges over black and white |
| Clone Stamp / paint | paints in the Layer panel | names the donor time and offset | reviews the painted range in motion |

Writing keyframes or importing an alpha isn't automatic tracking or roto.
If nobody can do the manual step, say what's missing and stop.

## Look at it in motion

- **Before and after, same frames.** `ae_review_motion` on the clean comp
  and on the original, same `start` and `duration`. Render both and compare
  with `video-reference-compare` (`--diff` shows exactly what changed; if
  the difference is black, nothing was fixed).
- **Never present an unchanged original as a fix**, or a single good frame
  as a finished shot.
- **Read the failure before you change anything.** Lines that slide over the
  surface are a tracking (registration) problem. Stable shapes with shifting
  brightness are a light or colour problem. An edge that follows the matte is a
  matte problem. Fix that part, keep the parts that work.
- **If the same failure comes back, change the construction** (a donor
  instead of fill, four points instead of one, a holdout), not the settings.

After `ae_render_video`, run the temporal check on the file:

```
node skills/ae-vfx-cleanup/scripts/temporal-qa.js clean.mov --source plate.mov --crop 0.4:0.35:0.2:0.3
```

It runs ffmpeg `freezedetect` and `mpdecimate`, compares frame counts with
ffprobe, and prints JSON with `check`: the frame ranges to render and look
at. **Use `--crop` on the repair area:** a frozen patch in a moving shot is
invisible to a whole-frame check. Freezes and repeats the source already had
are left out. Every range in `check` gets an `ae_render_frame` at full size.
