---
name: ae-ui-motion
description: App and product-launch motion in After Effects through the AE MCP Bridge - soft mesh-gradient backgrounds, UI screens as layered 3D panels with perspective tilts and rim light, cards that cascade in, AI responses that stream in with a shimmer, device mockups, a logo that becomes the app header, light-to-dark theme switches for a premium tier, particle dissolves into a logo, and a light-sweep end card. Use when asked for an app launch, product demo, SaaS or AI feature video, UI walkthrough, or "make the interface feel alive".
---

# UI and product-launch motion

Launch films for apps rarely show a screen recording. They rebuild the UI as
layers and move those like objects in a space: calm, bright and precise, with
one idea per beat. This skill is the toolkit for that style. Timing and
easing come from `ae-motion-principles`, type from `ae-typography`, and camera
and depth from `ae-camera-3d`.

## The ground: a soft mesh gradient

A pale, slowly drifting colour field behind everything, instead of white:

1. A light solid (`#f3f2f8` or similar) as the base.
2. Three to five large ellipses (`ae_shape`, 900–1400 px) in brand tints,
   each with `ADBE Gaussian Blur 2` at Blurriness 250–400 and Repeat Edge
   Pixels on.
3. Drift each blob with a slow wiggle on Position (`wiggle(0.15, 180)`) so
   the light moves but nothing draws the eye.

Keep blob saturation low. The UI and the words carry the colour.

## Rebuild the UI as layers

Rebuild screens instead of importing a screenshot, or at least split a
screenshot into parts. Make each element its own layer: the window frame, the
sidebar, the header, the prompt field, each card. Then elements can arrive
separately and move in depth.

- Frame: a rounded rect (`ae_shape` rect, `roundness` 24–40) with a white
  fill and a 1–2 px stroke in a light brand gradient. That thin coloured
  edge is the "rim light" that makes the panel glow against the background.
- Soft shadow: `ADBE Drop Shadow`, Opacity 10–20%, Softness 60–120,
  Distance 20–40. Never a hard shadow.
- Precompose the whole screen (`ae_precompose`) and move the precomp. Turn
  on collapse transformations (`collapseTransformation: true`) so it stays
  sharp in 3D.

## Moving screens in space

- **Perspective entrance.** Make the screen precomp 3D, start it at
  Y Rotation −25°, X Rotation 10° and Z +600, then settle it to a gentle
  resting tilt (Y −8° to 0°) over 20–30 frames with a landing ease of 85–90.
  Add a camera (`ae-camera-3d`) and push in slowly while the content reads.
- **Cascading cards.** Suggestion cards and list items rise from Y +60 and
  Opacity 0, staggered 3–4 frames apart (`ae_edit_keyframes` with `copyTo`
  and an offset, or `ae_layer_action` sequence). The first card leads and the
  rest follow like a wave.
- **Focus by depth.** When one card matters, bring it forward in Z and let the
  others fall back with camera depth of field. Don't highlight it with
  colour.

## Text that feels generated

For an AI answer arriving:

- A range selector on Opacity (and a little Blur), Based On 1 (characters),
  with Offset keyed across the answer's length at a reading-speed pace
  (about 40–60 characters a second). See `ae-typography`.
- A **shimmer** running just ahead of the reveal: a second animator with
  Fill Color set to the brand gradient's accent, and its own range selector
  a few percent ahead of the first. Where it passes, the characters flash the
  accent colour, then settle to the body colour.
- A small sparkle icon beside the answer that pulses scale 100 → 115 → 100
  while the text is streaming, and stops when the text stops.

## Devices

- Phone and laptop mockups are precomps of the UI inside a device frame
  (a rounded rect for the body, a smaller one for the screen area as a
  track matte).
- Tilt the device in 3D (X 15–25°, Y ±20°) and dolly the camera past it.
  Keep tilts moving slowly, because a static tilted device looks like a
  mistake.
- Show input as real UI states: a keyboard sliding up, a button pressed
  (Scale 100 → 94 → 100 over 6 frames), a photo dropping into the chat.

## Continuity between scenes

The style's signature is that nothing cuts. The last element of one scene
becomes the first of the next:

- A **logo becomes the app header.** Scale the logo down and move it to where
  the app's title sits, then reveal the window around it: the frame's mask
  grows outward from the logo (see `ae-transitions`).
- A **word becomes a UI element.** A highlighted word in a sentence turns
  into the chip or menu item it's talking about, by scaling and moving into
  place and crossfading to the UI version over 4–6 frames.
- A **line of text becomes a ring** that frames the next title (see the text
  on a circle recipe in `ae-typography`).

## A theme switch for the premium tier

To mark a higher tier, the world turns dark:

1. Dip the background to near-black (`#0e0e12`) over 6–10 frames, keyed on
   the base solid's colour or a black solid's Opacity.
2. UI panels flip to dark fills. Their rim-light strokes gain intensity:
   add `ADBE Glo2` with a tight radius so edges look lit.
3. Brand words take a gradient that glows (see `ae-effects`: two stacked
   glows).
4. Floating cards spread out in depth with depth of field, so the premium
   features read as a space you look into.

## Logo moments

- **Particle dissolve into the logo.** Text breaks into particles that swirl
  and settle into the logo. Build it in native After Effects as a timing
  illusion: animate the outgoing text with `ADBE Turbulent Displace` (Amount
  0 → 200) and `ADBE Motion Blur` (Directional Blur) while it fades. Bring the
  logo in from the opposite side with the reverse (Displace 200 → 0, blur →
  0). Add `CC Particle World` or `CC Star Burst` sparks in brand colours in
  between, and flash the background from dark to light at the peak. Dedicated
  particle plug-ins do this more literally. Ask before assuming one is
  installed.
- **Light-sweep end card.** On black, a small bright core (a white ellipse
  with a strong glow) moves along the logo's outline while the logo reveals
  behind it. Use Trim Paths on a shape version of the logo stroke, or a
  Linear Wipe with heavy Feather. Add a soft coloured wash (`CC Light Rays`
  or a large blurred ellipse in the brand colours) that blooms and fades over
  about 1 s, and settle on the plain logo for at least a second of hold.

## Taste

- One message per beat, and one moving thing at a time. The UI moves
  *or* the text moves, rarely both.
- Motion is soft and slow at rest (drifts, gentle tilts) and quick at
  moments (a card landing in 8 frames). The contrast is what reads as
  premium.
- Keep real product details plausible: text the UI would really say, and
  states it would really show. Disclaimers such as "sequences shortened and
  simulated" belong in small type when a demo is idealised.

## Check it

`ae_review_motion` over every scene change, because continuity lives or dies
on 6 frames. `ae_render_frame` on each resting UI state, to check that text
is legible at the delivery size. With a reference film, compare it beat by
beat with `video-reference-compare`, and use `ae-reference-breakdown` to
extract its timing first.
