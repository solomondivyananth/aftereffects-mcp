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

A stack that behaves, most of the time:

| Order | Why |
|---|---|
| 1. Keying and matte work | everything after it should see the final alpha |
| 2. Distortion (displace, warp, lens) | it moves pixels; later effects should see where they ended up |
| 3. Stylize (posterize, find edges, mosaic) | on the distorted image, not the clean one |
| 4. Blur | blurs the result, which is almost always what you meant |
| 5. Glow and light | glows the blurred, stylized image — this is what makes light look real |
| 6. Grade (Lumetri, Curves, Tint) | last, so it grades everything above it |
| 7. Grain and vignette | on top of the grade, like a camera |

## Where the effect goes

The same effect gives three different results depending on what you put it
on. This decides more about the look than the parameters do.

| Put it on | When | Watch out |
|---|---|---|
| The layer | the effect belongs to that element alone | effects are clipped to the layer's own bounds |
| An adjustment layer | one treatment over everything below (grade, blur, glow, grain) | it affects every layer under it in that comp, including things you forgot |
| A precomp | the effect must see several layers as one image, or you need the result blurred *together* | a precomp resets 3D space and collapses nothing unless you switch Collapse Transformations on |

Two bounds traps, both of which look like the effect is broken:

- **Effects on a shape or text layer are clipped to that layer's own
  bounds.** A blurred blob drawn with `ae_shape` gets a hard straight edge
  where the shape's box ends. Put the blur on an adjustment layer above the
  shapes instead — the soft-gradient recipe in `ae-ui-motion` relies on this.
- **An effect that grows the image** (glow, blur, drop shadow, displace) is
  cut off at the layer's edge. Add `ADBE GROW BOUNDS` (Grow Bounds) *before*
  it in the stack, or precompose with "move all attributes".

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

## Presets and behaviours (After Effects 2026)

AE 2026 ships two families of ready-made effects that save building things by
hand. Both are real effects, so `ae_apply_effect` applies them and returns
their parameters — read the names back from that call rather than guessing
them, because they differ from the hand-built equivalents.

| Family | matchName prefix | What is in it |
|---|---|---|
| Motion presets | `ADBE CM …` | Light Leaks, Mood Lighting (amorphous, digital, streaks), Inset Video (framed, torn edges), Cracked Tiles, Autoscroll, Drift Over Time, Fade In+Out, Rotate Over Time, Scale Bounce, the Wiggle family, and a set of transition master controls |
| Dynamic behaviours | `ADBE DE …` | Bounce, Wobble Bounce, Pulse, Oscillate, Pendulum, Jiggle, Swarm, Follow, Orbit, Z Spring, Random Motion/Rotation/Scale/Opacity — most with `At Marker`, `On Beat` and `Random` variants |

The behaviours are motion, not looks: they belong to `ae-motion-principles`.
The motion presets are looks — `ADBE CM LightLeaksMarkers` on an adjustment
layer gives per-marker light leaks in one call, where the hand-built version
is three layers and a blend mode. List what this install has with
`ae_catalog {"kind": "effects", "query": "light leaks"}`.

Also new in this generation: `ADBE Curl Noise` (Curl Noise), a flowing noise
field that suits smoke, ink and fluid-looking drift better than Fractal
Noise's boiling.

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

## Exposing an effect for a person to drive

When a person or a template needs a dial, add an Expression Control to a
Controls null and point the effect's parameter at it. The controls are
effects themselves:

| Control | matchName |
|---|---|
| Slider | `ADBE Slider Control` |
| Colour | `ADBE Color Control` |
| Checkbox | `ADBE Checkbox Control` |
| Dropdown Menu | `ADBE Dropdown Control` |
| Angle · Point · 3D Point · Layer | `ADBE Angle Control` · `ADBE Point Control` · `ADBE Point3D Control` · `ADBE Layer Control` |

Then the effect reads it:
`thisComp.layer("Controls").effect("Glow Strength")("Slider")`. That single
slider can drive both glows in the stack, so one dial changes the whole look
(`ae-templates` for putting it in Essential Graphics).

## When it looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| The glow is a grey haze | the threshold is too low, so mid-tones glow | raise Glow Threshold to 50–70; glow only the bright core |
| A full-frame blur fades at the edges | the blur samples empty space outside the layer | Repeat Edge Pixels on, or Grow Bounds before it |
| The effect stops at a straight edge | it is on a shape or text layer, clipped to its bounds | move it to an adjustment layer, or Grow Bounds |
| Gradients show bands | 8 bits per channel is not enough for a smooth ramp | set the project to 16 bpc, or add `ADBE Noise2` at 1–2% over the gradient |
| Particles vanish at the frame edge | the producer is inside the frame and the layer is the frame | enlarge the layer, or use a comp-sized solid and Grow Bounds |
| The chromatic split looks muddy | the copies are blending normally | set them to `add`, and keep the offset under about 6 px |
| A "3D" effect ignores the camera | most effects are 2D and render after the transform | use a real 3D layer or the Advanced 3D renderer (`ae-camera-3d`) |
| Everything renders slowly | Camera Lens Blur, particles, high Complexity noise, motion blur | preview with `ae_render_frame {"downscale": 4}`, raise quality last |

## Always look

Effects are judged by eye. After each one, `ae_render_frame` at a
representative moment — and at `downscale: 1` for anything whose point is
detail, because a contact sheet hides grain, banding and soft edges. For
anything animated (noise, particles, blur), `ae_review_motion`. Report the
look, not the parameter values.

`ae_proof` will not judge a look, but it does catch what effects tend to
break around them: layers moving fast enough to strobe with motion blur off,
footage pushed past 100%, an effect switched off and forgotten
(`ae-motion-proof`).
