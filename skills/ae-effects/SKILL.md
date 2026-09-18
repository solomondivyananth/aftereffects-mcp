---
name: ae-effects
description: Special effects, blur and motion blur in After Effects through the AE MCP Bridge - glows, light rays and flares, fractal noise, displacement and distortion, particles, chromatic split, grain, stylized looks, and every kind of blur (Gaussian, directional, radial, lens blur, pixel motion blur, comp motion blur), with exact effect and parameter names. Use when asked for a look or an effect (glow, energy, glitch, heat haze, smoke, sparks, dreamy, filmic, whip blur), or when motion looks strobey and needs blur.
---

# Effects and blur

Effects are applied with `ae_apply_effect`: pass the display name or the
matchName, and parameter values by name. The call returns every parameter,
so the next call can set the rest. Names below are the exact ones After
Effects uses. If one isn't found, the effect isn't installed: look it up with
`ae_catalog {"kind": "effects", "query": "…"}`.

```json
ae_apply_effect {"layer": "Logo", "effect": "ADBE Glo2",
                 "params": {"Glow Threshold": 60, "Glow Radius": 40, "Glow Intensity": 1.2}}
```

Order matters. Effects render top to bottom, so a glow after a blur glows the
blurred result. Reorder with `ae_property_meta {"path": ["Effects","Glow"], "index": 1}`.
Toggle one off (the fx switch) with `"enabled": false`.

## Glow, light, energy

| Effect | matchName | Key parameters |
|---|---|---|
| Glow | `ADBE Glo2` | Glow Threshold, Glow Radius, Glow Intensity, Glow Colors, Color A, Color B |
| CC Light Rays | `CC Light Rays` | Intensity, Center, Radius, Warp Softness, Color |
| Lens Flare | `ADBE Lens Flare` | Flare Center, Flare Brightness, Lens Type |
| Beam | `ADBE Laser` | start and end points, length, thickness |
| Advanced Lightning | `ADBE Lightning 2` | origin, direction, conductivity |

A glow that reads as light, not a grey blob: stack **two** glows. The first
is tight (radius 10–20, intensity 1–1.5). The second is wide (radius 80–200,
intensity 0.3–0.6). Keep the threshold high so only the bright core glows.
For neon, set Glow Colors to A & B colors with a saturated Color A and
Color B.

## Texture, smoke, organic motion

| Effect | matchName | Key parameters |
|---|---|---|
| Fractal Noise | `ADBE Fractal Noise` | Fractal Type, Noise Type, Contrast, Brightness, Scale, Complexity, Evolution |
| Turbulent Noise | `ADBE AIF Perlin Noise 3D` | same controls, faster |
| Turbulent Displace | `ADBE Turbulent Displace` | Displacement, Amount, Size, Complexity, Evolution |
| Displacement Map | `ADBE Displacement Map` | Displacement Map Layer, Max Horizontal Displacement, Max Vertical Displacement |
| Wave Warp | `ADBE Wave Warp` | Wave Type, Wave Height, Wave Width, Direction, Wave Speed |
| Roughen Edges | `ADBE Roughen Edges` | Edge Type, Border, Edge Sharpness, Fractal Influence |
| Add Grain | `VISINF Grain Implant` | Intensity, Size, Softness |

Animate noise with an expression, not keyframes. On
`["Effects","Fractal Noise","Evolution"]`: `time * 90`. For a heat haze, put
Turbulent Displace (Amount 5–10, Size 40–80) on an adjustment layer and
animate its Evolution the same way.

## Particles and simulation

| Effect | matchName | Use |
|---|---|---|
| CC Particle World | `CC Particle World` | sparks, dust, confetti: Birth Rate, Longevity (sec), Producer, Physics |
| CC Star Burst | `CC Star Burst` | star fields, fly-throughs |
| CC Rainfall · CC Snowfall | `CSRainfall` · `CSSnowfall` | weather |
| Shatter | `APC Shatter` | break a layer into pieces |
| Card Dance | `APC CardDanceCam` | grid of cards driven by a gradient |

Particles are heavy. Preview with `ae_render_frame` at `downscale: 4`, and
limit Birth Rate before raising quality.

## Glitch and chromatic split

After Effects has no native chromatic aberration. Build it:

1. `ae_layer_action {"action": "duplicate"}` twice, so there are three copies.
2. On each copy, `ADBE Shift Channels` (Take Red From / Take Green From /
   Take Blue From) keeps one channel.
3. Set the copies' `blendingMode` to `"add"` and offset them 2–6 px apart.

For glitch frames, add `ADBE Offset` (Shift Center To) and `ADBE Mosaic` on
1–2-frame hold keys, and `ADBE Posterize Time` (Frame Rate 8–12) for a
stepped look.

## Stylize and colour

| Look | Effects |
|---|---|
| Duotone or brand tint | `ADBE Tint` (Map Black To, Map White To) or `ADBE Tritone` |
| Grade | `ADBE Lumetri`, or `ADBE Easy Levels2` (Levels) and `ADBE CurvesCustom` (Curves) |
| Flat fill for silhouettes | `ADBE Fill` (Color) |
| Shadow | `ADBE Drop Shadow` (Shadow Color, Opacity, Direction, Distance, Softness) |
| Lens distortion | `CC Lens` (Size, Convergence), `ADBE Optics Compensation` (Field Of View), `ADBE Bulge` |
| Kaleidoscope | `CC Kaleida` |
| Echo trails | `ADBE Echo` (Echo Time (seconds), Number Of Echoes, Decay) |
| Tile for seamless moves | `ADBE Tile` (Motion Tile: Output Width/Height, Mirror Edges) |

Layer styles (Drop Shadow, Outer Glow, Bevel as *layer styles*) are menu
commands: `ae_menu_command {"command": "Drop Shadow", "layer": "Title"}`.

## Blur

| Blur | matchName | Parameters | Use for |
|---|---|---|---|
| Gaussian Blur | `ADBE Gaussian Blur 2` | Blurriness, Blur Dimensions, Repeat Edge Pixels | soft focus, backgrounds |
| Fast Box Blur | `ADBE Box Blur2` | Blur Radius, Iterations | the same, faster, big radii |
| Directional Blur | `ADBE Motion Blur` | Direction, Blur Length | whip moves, speed lines |
| Radial Blur | `ADBE Radial Blur` | Amount, Center, Type (Spin / Zoom) | zoom punch-ins, spins |
| CC Radial Fast Blur | `CC Radial Fast Blur` | Center, Amount, Zoom | fast zoom and light-streak blur |
| Camera Lens Blur | `ADBE Camera Lens Blur` | Blur Radius, Iris Properties, Blur Map | real bokeh, depth from a map |
| Bilateral Blur | `ADBE Bilateral` | | smoothing that keeps edges |

**Repeat Edge Pixels** on Gaussian Blur stops a full-frame blur fading at the
edges. Turn it on for backgrounds.

Animate a blur *with* the move. A whip: Directional Blur Blur Length
0 → 80 → 0 over the 4–6 frames of the fastest part, Direction matching the
motion.

## Motion blur

Moving layers without motion blur look like stop-motion.

1. The comp switch: `ae_set_comp_settings {"settings": {"motionBlur": true, "shutterAngle": 180, "shutterPhase": -90}}`.
   180° is film-natural; 270–360° is smeary and fast.
2. The layer switch: `ae_set_layer_props {"layers": "all", "props": {"motionBlur": true}}`.
   Both switches must be on.
3. For things layer motion blur can't see:

| Case | Fix |
|---|---|
| Motion inside a precomp | `CC Force Motion Blur` on the precomp layer (Motion Blur Samples) |
| Motion in footage | `ADBE OFMotionBlur` (Pixel Motion Blur: Shutter Angle, Shutter Samples) |
| An effect-driven move | the `ADBE Geometry2` (Transform effect) Shutter Angle, with Use Composition's Shutter Angle off |

Motion blur multiplies render time. Leave it on for final renders, and use
`downscale` for previews.

## Always look

Effects are judged by eye. After each one, `ae_render_frame` at a
representative moment. For anything animated (noise, particles, blur),
`ae_review_motion`. Report the look, not the parameter values.
