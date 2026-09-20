---
name: ae-camera-3d
description: Cameras and 3D scenes in After Effects through the AE MCP Bridge - 3D layers and depth, camera rigs on nulls (dolly, orbit, push-in, parallax), depth of field, lights and shadows, materials, choosing the 3D renderer, 3D models, camera shake, and what the 3D camera tracker needs a person for. Use when asked for a camera move, parallax, depth, a 3D scene or extrusion, lighting, shadows, bokeh, or when layers should feel like they sit in space.
---

# Camera and 3D

Any layer becomes 3D with `ae_set_layer_props {"props": {"threeDLayer": true}}`.
It then has Z Position, X/Y/Z Rotation and Orientation, and responds to
cameras and lights. Position becomes `[x, y, z]`: +Z is away from the camera.

## The renderer

The comp's 3D renderer decides what 3D can do. Set it with
`ae_set_comp_settings {"settings": {"renderer": "…"}}`:

| Renderer | Value | Use for |
|---|---|---|
| Classic 3D | `ADBE Advanced 3d` | flat layers in space, fast; lights and shadows |
| Advanced 3D (AE 2023+) | `ADBE Calder` | 3D models (glTF, GLB, OBJ), environment lighting, reflections, GPU |
| Cinema 4D | `ADBE Ernst` | extruded text and shapes (bevels, depth) |

## The lens, in numbers

After Effects measures a camera's Zoom in **pixels**, not millimetres. The
conversion, for a 36 mm-wide sensor:

```
zoom_px = comp_width × focal_mm / 36
focal_mm = 36 × zoom_px / comp_width
fov = 2 × atan(comp_width / (2 × zoom_px))
```

So on a 1920-wide comp: a 24 mm wide lens is zoom 1280, a 35 mm is 1867, a
50 mm is 2667, an 85 mm portrait lens is 4533. On a 1080-wide vertical comp a
50 mm is zoom 1500 — which is exactly what After Effects writes when you
create a camera with the 50 mm preset, so the formula is the same one it
uses.

| Lens | Feel | Use for |
|---|---|---|
| 18–28 mm | exaggerated depth, edges stretch | pushing through a scene, drama |
| 35–50 mm | close to how a room looks | most product and UI work |
| 85–135 mm | flat, compressed, elegant | beauty shots, slow drifts, logo ends |

Two consequences worth knowing before you place anything:

- **A long lens kills parallax.** If the move needs depth to read, use a
  wider lens and a shorter dolly rather than a long lens and a big one.
- **Moving a layer back by Δz and keeping its size** means scaling it by
  `(zoom + Δz) / zoom`. That is the whole trick behind flat artwork laid out
  in depth.

## Build depth first

Space the layers in Z before any camera exists. Foreground at Z −400 to
−200, subject at 0, background at +800 to +2000. Scale the far layers up so
they still fill the frame, by the factor above. Parallax comes from these Z
gaps, not from animating each layer separately.

A layout that reads, for a 1920×1080 comp with a 35 mm lens (zoom 1867):

| Plane | Z | Scale to hold size |
|---|---|---|
| Foreground furniture | −300 | 84% |
| Subject | 0 | 100% |
| Mid | +600 | 132% |
| Background | +1600 | 186% |

## A camera rig

Never animate the camera directly. Parent it to nulls so each move is one
property:

```json
ae_create_layer {"kind": "camera", "options": {"name": "Camera"}}
ae_create_layer {"kind": "null", "options": {"name": "Cam Dolly", "threeD": true}}
ae_create_layer {"kind": "null", "options": {"name": "Cam Orbit", "threeD": true}}
ae_set_layer_props {"layer": "Camera", "props": {"parent": "Cam Dolly"}}
ae_set_layer_props {"layer": "Cam Dolly", "props": {"parent": "Cam Orbit"}}
```

Put Cam Orbit at the subject's position.

**Parenting order matters.** After Effects keeps a child's look in the world
when it's parented. A layer that is already 3D, parented to a *rotated* 3D
parent, gets a counter-rotation and leaves the parent's plane: layers
"slice" into each other. Parent while the child is 2D, then set
`threeDLayer: true`. (`ae_set_layer_props` applies `parent` before
everything else in the same call.)

Then:

| Move | Animate |
|---|---|
| Push-in / dolly | Cam Dolly Z Position (toward the subject) |
| Orbit | Cam Orbit Y Rotation (or X for a crane) |
| Truck / pedestal | Cam Orbit X or Y Position |
| Roll | Cam Orbit Z Rotation |

Ease camera moves long and soft (landing ease 80–95, 20–60 frames), because
cameras have weight. Add a subtle handheld feel on the Camera itself:
`wiggle(0.6, 6)` on Position (see `ae-expressions`).

Numbers that read as deliberate rather than accidental:

| Move | Amount | Frames (30 fps) |
|---|---|---|
| Slow push (a shot that breathes) | 4–8% of the distance to the subject | 90–180 |
| Reveal push | 15–30% | 30–60 |
| Orbit around a subject | 15–35° | 45–90 |
| Whip to a new subject | 60–120° | 8–14, with motion blur |
| Crane down onto a layout | 20–40° on X | 45–75 |

**Orientation aims, Rotation animates.** Set a camera or layer's Orientation
once to point it where it should look, and keyframe X/Y/Z Rotation for the
move. Animating both, or animating Orientation across more than 90°, is how
you get a flip halfway through that nothing in the values explains.

**Turn motion blur on for camera moves.** A camera move is the fastest thing
in most comps, and without blur a push-in strobes on every edge.

A camera's transform paths are `["Transform","Point of Interest"]`,
`["Transform","Position"]` and so on. Its lens settings are under
`["Camera Options", …]`.

## Depth of field

| Property (under Camera Options) | What it does |
|---|---|
| Zoom | lens focal length in pixels: bigger is more telephoto |
| Depth of Field | on/off |
| Focus Distance | distance from the camera that is sharp |
| Aperture | larger is shallower focus |
| Blur Level | 0–100%+ strength |
| Iris Shape, Iris Rotation, Highlight Gain | bokeh character |

A rack focus: key Focus Distance from the foreground layer's distance to the
background's over 15–30 frames, eased. To keep focus locked on a layer, use
an expression on Focus Distance:

```js
length(thisComp.layer("Subject").toWorld([0,0,0]), toWorld([0,0,0]))
```

## What each renderer costs you

The renderer is not only about features; it changes which of your other
tools still work. Test with one `ae_render_frame` after switching, because
the viewport and the render can disagree.

| Renderer | Gives you | Takes away |
|---|---|---|
| Classic 3D | lights, shadows, intersecting layers, everything 2D still works | no extrusion, no real materials |
| Cinema 4D (`ADBE Ernst`) | extruded text and shapes, bevels | blend modes and track mattes on 3D layers are ignored; slower |
| Advanced 3D (`ADBE Calder`) | imported 3D models, environment lighting, reflections, GPU speed | needs a capable GPU; some legacy effects behave differently |

Whatever the renderer, effects are 2D: they run *after* the layer is placed
in space, so a glow on a tilted 3D layer is a flat glow on the flat result.
If an effect must live in the scene, put it on a precomp and make that
precomp the 3D layer.

## Lights and shadows

`ae_create_layer {"kind": "light", "options": {"name": "Key", "lightType": "spot"}}`
(`parallel`, `spot`, `point` or `ambient`).

| Light Options | |
|---|---|
| Intensity, Color | brightness (%) and tint |
| Cone Angle, Cone Feather | spot size and softness |
| Falloff, Radius, Falloff Distance | how light fades with distance |
| Casts Shadows, Shadow Darkness, Shadow Diffusion | shadows (soft = higher diffusion) |

Layers only cast and receive shadows when their Material Options allow it:

```json
ae_set_property {"layer": "Card", "path": ["Material Options","Casts Shadows"], "value": 1}
ae_set_property {"layer": "Floor", "path": ["Material Options","Accepts Shadows"], "value": 1}
```

Other material settings: Accepts Lights, Ambient, Diffuse, Specular
Intensity, Specular Shininess, Metal, Reflection Intensity, Transparency,
Index of Refraction. A classic setup: key light 100%, a dim ambient at
20–30% so shadows aren't black, and one rim light behind the subject.

## 3D models

With the Advanced 3D renderer (AE 2023+), `ae_import_file` a `.glb`, `.gltf`
or `.obj` and add it with `ae_create_layer` kind `footage`. Models are lit
by the comp's lights, or by an environment light (image-based lighting).

## Camera shake and impacts

Shake the camera, not the layers, so the whole scene moves together and the
parallax stays right. Put the marker-driven decaying shake from
`ae-expressions` on Cam Orbit Position, scaled down (amplitude 4–10) for 3D.

## What goes wrong in 3D

| Symptom | Cause | Fix |
|---|---|---|
| Layers slice into each other | two 3D layers intersect, or a child was parented after it went 3D | separate them in Z; parent while 2D, then set `threeDLayer` |
| A layer vanishes when the camera moves | it is edge-on to the camera | give it a small X or Y rotation, or make it face the camera |
| The move flips halfway | Orientation and Rotation are both animated | animate Rotation only |
| Everything is dark | a light is in the scene and layers accept lights | add ambient light at 20–30%, or switch Accepts Lights off on flat UI layers |
| Shadows look like blobs | a spot light very close, with high diffusion | move the light back, lower Shadow Diffusion |
| Focus drifts | Focus Distance is keyed but the camera also moves | drive Focus Distance from the subject with the expression above |
| The background shows its edges | a far layer was never scaled up | scale by `(zoom + Δz) / zoom` |
| It renders forever | depth of field plus shadows plus motion blur | preview with `downscale: 4`, and turn depth of field on last |

## What needs a person

- **3D Camera Tracker** (tracking real footage to get a camera) isn't
  scriptable. Ask the user to run Animation ▸ Track Camera on the footage.
  Once it has a solved camera, everything above works with it.
- Choosing an environment light's image (HDRI) is set in the Effect Controls
  or Project panel. Ask, or import the image and let the user assign it.

## Check it

Depth and camera moves only read in motion. `ae_review_motion` over the
whole move, and look for:
- layers that pass through each other or pop in Z
- edges of too-small background layers showing
- shadows that swim
- focus landing late

`ae_render_frame` at the start, middle and end confirms composition at each
point of the move.

`ae_proof` helps less here than elsewhere, and says so: once a camera is in
the comp it skips its space rules for 3D layers, because the sampler measures
flat boxes, not what the camera sees (`ae-motion-proof` names the layers it
skipped). Its timing, easing and integrity checks still apply to camera
moves — a camera's keyframes are keyframes like any others.
