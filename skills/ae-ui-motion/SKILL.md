---
name: ae-ui-motion
description: App and product-launch motion in After Effects through the AE MCP Bridge - soft mesh-gradient backgrounds, UI screens as layered 3D panels with perspective tilts and rim light, cards that cascade in, carousels and coverflow on one slider, glass panels, looping collaboration cursors, AI responses that stream in with a shimmer, device mockups, a logo that becomes the app header, light-to-dark theme switches for a premium tier, particle dissolves into a logo, and a light-sweep end card. Use when asked for an app launch, product demo, SaaS or AI feature video, UI walkthrough, or "make the interface feel alive".
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
   at 25–45% opacity. Place them with the shape group's own position
   (`transform: {position: …}`), leaving the layers centred.
3. **One** adjustment layer above them with `ADBE Gaussian Blur 2` (Blurriness
   250–400, Repeat Edge Pixels on). Don't blur each shape: effects on a
   shape layer are clipped to the shape's bounds, which leaves hard straight
   edges in the gradient.
4. Drift each blob with a slow wiggle on its group's Position
   (`wiggle(0.15, 180)`), so the light moves but nothing draws the eye.

Keep blob saturation low. The UI and the words carry the colour.

## Rebuild, or record?

| Route | When | Cost |
|---|---|---|
| Rebuild as layers | the product is the story, the UI must move in depth, or the feature does not exist yet | hours, but every element can be animated separately |
| Screen recording, cleaned up | the real interaction is the point, or the UI is too complex to fake | fast, but it is flat: you can push in and mask, not move parts |
| A hybrid | most launch films: a recording inside a rebuilt frame, with two or three rebuilt elements floating in front | the usual answer |

Cleaning up a recording: crop to the content, hide the real cursor and
animate a drawn one, cut the dead time between actions (nobody wants real
loading), and freeze on the state that matters for a beat longer than it
really lasted. Say in the film's small print when timings are shortened.

## The kit, with numbers

A UI that reads as designed rather than assembled, for a 1080p frame:

| Element | Value |
|---|---|
| Spacing | a 4 px grid; 8, 16, 24, 32 for real gaps |
| Corner radius | 8 for chips, 12–16 for cards, 24–40 for a window frame |
| Panel width | 60–75% of frame width, so the background still reads |
| Stroke | 1–2 px, in a light brand gradient — the "rim light" |
| Shadow | two: an ambient one (opacity 8–12%, softness 80–120, distance 0) and a key one (opacity 12–18%, softness 40–60, distance 20–40) |
| Body text in-frame | at least 24 px, ideally 28–32 |
| Accent | one per screen |

Two shadows instead of one is most of the difference between "3D card" and
"drop shadow from 2009".

**Keep strokes on whole pixels.** A 1 px stroke on a layer sitting at a
fractional position shimmers as it drifts; `ae_proof` reports it as
`sub-pixel`. Either hold the panel still on whole pixels, or move it fast
enough to hide it.

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
- Either precompose the whole screen (`ae_precompose`) and move the precomp
  in 3D, or parent the UI parts to a 3D panel layer. When parenting, **parent
  while the child is still 2D, then make it 3D**. A layer that is already 3D
  gets a counter-rotation from the tilted parent and slices through it.
- The `app-card` template (`ae-ai-templates`) is a working example of this
  whole setup.

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

## Carousels and coverflow

Drive every card from one **Slide** slider on the Controls null, never by
keying each card. Key Slide from 0 to 1, 2, 3 with holds between steps, and
every card moves together with the same ease. Name the cards "Card 1" …
"Card N", make them 3D, and put this on each card's Position:

```js
var c = thisComp.layer("Controls");
var slide = c.effect("Slide")("Slider");
var n = c.effect("Count")("Slider");
var i = parseInt(thisLayer.name.split(" ").pop(), 10) - 1;
var d = i - slide;
d = ((d % n) + n) % n;
if (d > n / 2) { d -= n; }
[thisComp.width / 2 + d * 420, value[1], Math.abs(d) * 320]
```

The two lines with `%` wrap the carousel so it loops. JavaScript's `%` keeps
the sign of the left side (`-1 % 5` is `-1`), so the `+ n` and second `%`
bring negative offsets back into range. Without them, sliding backwards past
the first card breaks the loop. On Y Rotation, `d` from the same lines gives
the coverflow turn:

```js
var c = thisComp.layer("Controls");
var n = c.effect("Count")("Slider");
var d = parseInt(thisLayer.name.split(" ").pop(), 10) - 1 - c.effect("Slide")("Slider");
d = ((d % n) + n) % n;
if (d > n / 2) { d -= n; }
-clamp(d, -1, 1) * 50
```

Fade cards beyond ±2 with Opacity `linear(Math.abs(d), 2, 3, 100, 0)`. Then
check the ones that are gone: a card at Opacity 0 can still cast shadows or
hide what's behind it in some renderers, so render the frame where a card
wraps around.

## Glass panels

A glass panel is not a white rectangle at 20% opacity. It is the background
seen *through* something: blurred, bent at the edges, lit along the rim,
tinted a little. It shows nothing over a flat colour, so test it over a busy
background.

1. **The shape**: a rounded rectangle, `ae_shape`, named "Glass Shape".
2. **The see-through**: an adjustment layer above the background, with its
   track matte set to the shape (`trackMatte {"layer": "Glass Shape",
   "type": "alpha"}`). On it: Gaussian Blur (Blurriness 25–40, Repeat Edge
   Pixels on), then Bulge (`ADBE Bulge`) centred on the panel with a small
   Bump Height (0.2–0.4) so the background bends near the edges like thick
   glass.
3. **Tint**: a duplicate of the shape with a white fill at 6–12%. Use a
   brand tint only if the design asks for one.
4. **Rim light**: a 1–2 px stroke on another duplicate, gradient from white
   at about 60% (top left) to 0 (bottom right), so the light has a
   direction. A second, darker stroke at the opposite corner in Multiply
   gives the edge thickness.
5. **Shadow**: a Drop Shadow on the tint layer, soft (Softness 40–60) and
   light (Opacity 15–25%), so the panel sits above the page.

Parent every part to the Glass Shape, so moving or resizing it moves the
whole panel, and keep the matte directly above the adjustment layer. When
the panel moves over a moving background the blur and bend update live;
render it moving (`ae_review_motion`) and check the rim at full size
(`downscale: 1`).

## Cursors, clicks and scrolls

Nothing gives away a fake UI faster than a cursor that moves like a robot.

- **Move**: 8–14 frames, ease out of rest and into the target
  (`{out: 20}` / `{in: 85}`), on a slight arc — never a straight line.
- **Click**: the cursor dips 2 px, the target scales 100 → 96 → 100 over 6
  frames, and a soft ripple (a circle, opacity 30 → 0, scale 0 → 180%)
  expands from the click point over 10 frames.
- **Hover** before the click: the target lifts 2 px and its shadow grows,
  3 frames before the cursor arrives.
- **Scroll**: content moves with momentum — fast start, long decay
  (`{out: 10}` / `{in: 90}`) — and over-scrolls 12–20 px at the end of a
  list before settling back.
- **Type**: characters appear at 40–60 a second, not instantly, with the
  caret blinking at 2 Hz (`ae-typography`).

Every one of these should be 20–30% faster than real life. Real interaction
timings feel sluggish on screen.

**Collaboration cursors** (several named cursors wandering a whiteboard)
have to loop without a jump. `wiggle()` never returns to where it started,
so use sines whose frequencies are whole multiples of one loop length. They
are back at the start at the end of every loop:

```js
var loop = 6;
var p = 2 * Math.PI * (time % loop) / loop;
value + [140 * Math.sin(p) + 40 * Math.sin(3 * p), 80 * Math.sin(2 * p + 1)]
```

Give each cursor a different phase offset (`+ 1`, `+ 2.5`) and amplitude,
and parent its name tag to it. For handwriting on the board, draw centreline
strokes with `ae_shape` in the order a pen would, reveal them with Trim
Paths, and use them as the track matte of the real text layer, so the words
stay editable.

## States the product really has

- **Loading**: a skeleton (grey blocks at 8–12% opacity) with a shimmer
  sweeping across every 1.2–1.8s, not a spinner. Spinners say "waiting";
  skeletons say "arriving".
- **Empty**: worth showing for half a beat before content lands, so the
  content landing means something.
- **Progress**: a bar that eases and never quite reaches the end until the
  result appears.
- **Success**: a check that draws (Trim Paths, 8–10 frames) with a single
  soft pulse behind it. One beat, then move on.
- **Numbers in the UI**: plausible, consistent between screens, and counted
  up rather than cut (`ae-data-driven`).

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

## When it looks fake

| Symptom | Cause | Fix |
|---|---|---|
| The UI looks pasted on | no shadow, or one hard shadow, and no rim light | two soft shadows plus a 1–2 px gradient stroke |
| The panel slices through its parent | a 3D child parented to a tilted 3D parent | parent while 2D, then set `threeDLayer` |
| The gradient background has hard edges | the blur is on the shape layers | one adjustment layer above them |
| Everything moves at once | no stagger | 3–4 frames between elements; one idea per beat |
| Text is unreadable on a phone | UI type sized for a desktop viewer | 28 px minimum in frame; `ae_proof` `text-small` |
| The cursor looks mechanical | linear move, no hover, no click feedback | arc, ease, dip, ripple |
| The tilt looks like a mistake | a static tilted device | keep tilted things drifting slowly |
| It feels like a demo of transitions | a different move per scene | one continuity device, used throughout |

## Check it

`ae_review_motion` over every scene change, because continuity lives or dies
on 6 frames. `ae_render_frame` on each resting UI state at `downscale: 1`,
to check that text is legible at the delivery size — a shrunken contact
sheet flatters UI type badly.

Then `ae_proof` on each scene (`ae-motion-proof`). UI work is where its
checks earn their keep: overlapping chips, a card clipped by the frame in
the 9:16 cut, 1 px strokes shimmering, cascades whose offsets drifted.

With a reference film, compare it beat by beat with
`video-reference-compare`, and use `ae-reference-breakdown` to extract its
timing first.
