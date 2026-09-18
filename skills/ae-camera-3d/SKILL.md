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

## Build depth first

Space the layers in Z before any camera exists. Foreground at Z −400 to
−200, subject at 0, background at +800 to +2000. Scale the far layers up so
they still fill the frame (roughly `100 × (distance + zoom) / zoom` percent).
Parallax comes from these Z gaps, not from animating each layer separately.

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

Put Cam Orbit at the subject's position. Then:

| Move | Animate |
|---|---|
| Push-in / dolly | Cam Dolly Z Position (toward the subject) |
| Orbit | Cam Orbit Y Rotation (or X for a crane) |
| Truck / pedestal | Cam Orbit X or Y Position |
| Roll | Cam Orbit Z Rotation |

Ease camera moves long and soft (landing ease 80–95, 20–60 frames), because
cameras have weight. Add a subtle handheld feel on the Camera itself:
`wiggle(0.6, 6)` on Position (see `ae-expressions`).

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
