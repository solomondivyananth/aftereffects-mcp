---
name: ae-composition
description: Stage a frame in After Effects through the AE MCP Bridge - give every beat one dominant element, build scale hierarchy, use the whole frame instead of a band in the middle, vary the composition between beats, place things on a grid with real margins, crop and bleed deliberately, compose for 9x16 and 1x1, and check it with ae_proof's staging checks. Use when work looks flat, generic, empty, "like a slide", "like a wireframe" or "not designed", when every beat looks the same, when nothing on screen is big, or before a scenes gate.
---

# Composition

Most motion-design work that looks amateur is not badly animated. It is badly
staged: small elements floating in the middle of an empty frame, everything
the same size, every beat composed identically. Animation cannot fix that —
it just moves the problem around.

This is the layer under `ae-motion-principles`: what the frame looks like
when nothing is moving.

## The three faults that make work look generic

Check every beat against these before animating it.

**1. No focal point.** Something must be the thing you look at. The dominant
element should cover roughly **25–60% of the frame** and sit where the eye
lands first. If the biggest thing on screen is 10% of the frame, there is no
subject — only furniture.

**2. No scale contrast.** Hierarchy is size first, colour second, motion
third. The point of the beat wants to be **3–6× the size** of its supporting
elements. Two elements within 1.5× of each other read as a list, not a
statement.

**3. The frame is unused.** A 1080×1920 frame with everything in a band
between 25% and 70% of its height wastes half the picture, and in a feed the
empty bottom is where the platform's UI sits anyway. Either fill the frame or
compose the emptiness deliberately — a big element with air around it is a
composition; a small one is a gap.

`ae_proof` measures all three (`frame-unused`, `no-focal-point`,
`no-scale-contrast`), so you do not have to guess whether a beat is
under-staged. For a scene comp that gets its background from a master, pass
`{"staging": true}` — see `ae-motion-proof`.

## Staging a beat

1. **Say the beat in one sentence.** "Enquiries come back with names and
   numbers." Whatever is the subject of that sentence is the dominant
   element.
2. **Give it size.** Make it big before making it interesting. A card at 30%
   of the frame with a headline over it beats the same card at 12% with three
   supporting details.
3. **Add one supporting element, not four.** A label, a number, a rule.
   Everything else is noise at this scale.
4. **Place it off centre.** Dead-centre everything is the default that makes
   a film look like a slideshow. Offset the subject and balance it with the
   type block or with empty space.
5. **Let something bleed.** An element that runs off an edge tells the eye
   the world continues past the frame. One bleed per beat is usually enough.
6. **Then animate it** (`ae-motion-principles`).

## Numbers that hold up

For a 1080×1920 vertical frame (scale by the short side for other formats):

| | Value |
|---|---|
| Outer margin | 60–80 px, and never less than 40 |
| Grid | 12 columns of 75 px with 24 px gutters, or a simple 8 px rhythm |
| Dominant element | 25–60% of frame area |
| Supporting elements | a third to a sixth of the dominant's size |
| Display type | 120–220 px |
| Statement type | 60–110 px |
| Supporting type | 34–48 px |
| Smallest legible type | 24 px, and only for labels nobody has to read |
| Gap between unrelated blocks | 2–3× the gap inside a block |
| Safe band in 9:16 | keep the beat between 12% and 80% of the height |

The single most common fix in practice: **take whatever is on screen and
double it in size.** Work that looks under-designed is usually work that was
composed at desktop scale and never checked at phone scale.

## Varying between beats

A film where every beat is composed the same way is a slide deck with
transitions. Move the eye:

| Beat | Staging |
|---|---|
| 1 | full-bleed type, no other element |
| 2 | subject low, type high, wide air between them |
| 3 | close-up detail, cropped hard so it bleeds on two edges |
| 4 | two elements in a diagonal relationship |
| 5 | the subject small in a big field, on purpose, because the point is scale |
| 6 | full-frame colour change with the claim centred |

`ae_proof`'s `same-staging` check measures this: if every resting
composition in a film is centred on the same line, it says so.

Change **one** thing between neighbouring beats — position, scale or
crop — not all three, or the film stops feeling like one piece.

## Depth, light and texture

Flat fills read as a wireframe. Three cheap things separate a film from a
mockup, in the order they pay off:

1. **A background that is not one flat colour.** A soft gradient, a very
   large blurred shape in a second brand tint, or a slow vertical ramp.
   Blur on an adjustment layer above the shapes (`ae-effects`).
2. **Light.** A vignette that darkens the corners by 8–15%, and a lift where
   the subject sits. The eye goes to the brightest place — put it where the
   subject is.
3. **Grain.** 1–2% noise over everything, on one adjustment layer. It costs
   nothing, hides banding, and is most of what makes a flat graphic look
   filmed rather than exported.

Then depth: two or three planes at different Z with a slow camera push give
parallax that no amount of easing can imitate (`ae-camera-3d`).

## Cropping and bleeding

- **Crop into things.** A card shown whole is an object; a card cropped by
  the frame is a place. Close-ups are where product films get energy.
- **Bleed off one edge, not all four**, unless the element is a background.
- **Keep the crop consistent within a scene.** If the subject bleeds left on
  one beat, do not move it to bleed right on the next without a reason.

## Formats

A layout is not a size. A variant starts as a duplicate of the master
(`ae-deliver`), so it keeps the assets and the timing, and then gets restaged:

- **9:16** — stack what was side by side; raise type relative to width; keep
  the beat between 12% and 80% of the height.
- **1:1** — the tightest crop. Usually one element and one line of type.
- **16:9** — horizontal air is cheap; use it for pairs and comparisons.

Re-proof every variant. A layout that passes in 16:9 routinely shows up as
`clipped`, `safe-area` or `frame-unused` in 9:16.

## Check it

1. `ae_render_frame` at each beat's resting moment, at `downscale: 1`.
2. Ask of each frame: what is the subject, and is it the biggest thing here?
3. `ae_proof {"comp": …, "staging": true}` for the three faults and for
   `same-staging` across the film (`ae-motion-proof`).
4. Squint at the contact sheet. If every tile looks the same, the film has
   one composition and needs five.
