---
name: ae-reference-breakdown
description: Reverse-engineer a reference video into a beat map and a list of After Effects techniques you can rebuild with the AE MCP Bridge - probe it, find the cuts, read overview sheets, study the signature moves at native frame rate, name each technique in After Effects terms with timing in frames, test the risky ones in a scratch comp, and hand off to the craft skills. Includes a cross-platform script. Use when given a reference film or link and asked "how was this made", "make something like this", "match this style", or to turn a reel into reusable techniques or skills.
---

# Reference breakdown

The goal is not to copy the film. It's to understand it well enough to
rebuild the *techniques* in your own work. A breakdown ends with a beat map
and a list of techniques, each named in After Effects terms, timed in frames,
and verified in a scratch comp where it matters.

**Rights.** Work from files the user has the right to study: their own
work, a client's reference, or a publicly posted film for analysis. Keep the
downloaded file outside the project and the repo. Extract methods, not
assets: never reproduce a reference's copy, logos, characters or music in
what you make.

## 1. Get the file

A local file is best. For a link the user is entitled to study, `yt-dlp`
fetches it (1080p is plenty):

```
yt-dlp -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]" --merge-output-format mp4 -o ref.mp4 <url>
```

Keep the description too (`--write-description`). It often names the studio
and category, which tells you which style family you're in.

## 2. Run the breakdown

The script next to this file does the mechanical part. It needs Node, ffmpeg
and ffprobe, and runs on macOS and Windows:

```
node <this skill's directory>/scripts/breakdown.js ref.mp4 out/
node <this skill's directory>/scripts/breakdown.js ref.mp4 out/ --windows 0.9:2.1,13.7:16 --strip-fps 30
```

It prints the size, frame rate, duration and cut times, then writes:
- `overview_*.png`: the whole film at 1 frame a second (tile *n* = second
  *n*)
- `cut_*.png`: a strip around every hard cut
- `window_*.png`: strips for the windows you ask for
- `breakdown.json`: all of the above in one file

**Few cuts is information.** A 70-second film with four cuts is built on
continuity: scenes morph into each other. Expect match-moves and shape
transitions, not edits.

### Read the cut list as statistics

Before looking at a single frame, the cut times tell you the film's shape:

- **Mean shot length.** Under 1.5 s is a fast promo; 3–6 s is a product
  film; over 8 s is either luxury or a talking head.
- **Where the cuts bunch.** Density rising towards the end means a build to
  a payoff; even spacing means a list, not a story.
- **Few cuts is information.** A 70-second film with four cuts is built on
  continuity: scenes morph into each other. Expect match-moves and shape
  transitions, not edits (`ae-transitions`, `ae-morph`).
- **The longest shot is usually the point** — the hero product, the claim,
  the end card.

### Sample the palette and the type

Get the palette as numbers rather than adjectives:

```
ffmpeg -i ref.mp4 -vf "fps=1,scale=160:-1,palettegen=max_colors=8" -y palette.png
```

Read that PNG and write the hexes down. Then decide which is background,
which is neutral and which is the one accent (`ae-color`).

For type, note case, weight, width and tracking, and how big the display
type is as a fraction of frame height. Then find the nearest installed font
with `ae_catalog {"kind": "fonts", "query": "…"}` and say it is an
approximation — matching a typeface by eye is a guess, and a confident wrong
name is worse than "a grotesque close to Inter".

## 3. Make the beat map

Read the overview sheets and write one row per beat:

| Time | What the viewer sees | Technique (guess) |
|---|---|---|
| 0:00–0:08 | words arrive on a pale drifting gradient | word-by-word text animator; blurred shape blobs |
| 0:08 | cut to black, bright word | theme flip, glow on text |
| … | | |

Note the palette (sample it from frames), the type (weight, case, tracking),
the pace (seconds per beat), and the contrast pattern (light / dark / accent
beats).

## 4. Study the signature moves at native rate

For the three to eight moves that give the film its character, pull strips at
the film's frame rate (`--strip-fps` equal to its fps) and count frames:

- **Entrances and exits:** how many frames from start to rest, overshoot or
  not, blur or not, what leads.
- **Easing:** equal spacing between tiles means linear; bunched tiles at the
  end mean a strong ease-in to rest.
- **Stagger:** frames between elements that start one after another.
- **Depth:** does blur change with distance (depth of field)? Do layers move
  at different speeds (parallax, so a 3D camera)?
- **Colour and light:** additive glows, gradient fills, rim-lit edges,
  flashes.

Then name each move in After Effects terms, using the craft skills:

| Seen | Likely built with | Skill |
|---|---|---|
| letters rippling, words blurring in | text animators and selectors | `ae-typography` |
| overshoot, settle, stagger | keyframes and eases | `ae-motion-principles` |
| soft glows, particles, heat haze, whip blur | effects, motion blur | `ae-effects` |
| wipes, shape reveals, whip pans | masks, mattes, transition effects | `ae-transitions` |
| one shape becoming another | path morphs, gooey mattes | `ae-morph` |
| parallax, tilted cards, bokeh | 3D layers, camera rig, depth of field | `ae-camera-3d` |
| UI panels, streaming answers, devices | layered UI in 3D | `ae-ui-motion` |
| procedural drift, beat-synced hits | expressions, markers | `ae-expressions` |

Say how confident you are in each. "Particles could be a plug-in; a native
approximation follows" is more useful than a confident wrong guess.

### What to write down for each move

Vague notes produce vague rebuilds. For every signature move record:

| Field | Example |
|---|---|
| What moves | the headline, word by word |
| From → to | y +40 px and opacity 0 → rest |
| Frames | 14 to rest, no overshoot |
| Easing | bunched at the end: landing ease ~85 |
| Stagger | 3 frames between words |
| What leads | the blur clears before the position settles |
| Blur / blend | additive glow, tight radius |
| Confidence | high — plain text animator |

That table converts directly into `ae_add_keyframes` calls, which is the
point of doing it.

## 5. Prove the risky ones

Anything you're unsure of, build in a **scratch comp in a throwaway project**
and look at it: `ae_render_frame` at the key moment, and `ae_review_motion`
over the move. When it matters, compare against the reference frame by frame
with `video-reference-compare`. Only then write it down as a technique.

## 6. Write it up

The output is a short document:

1. **Identity:** the palette, type, pace and contrast pattern.
2. **Beat map:** the table from step 3, with times.
3. **Techniques:** for each one, what it is, how to build it (tool calls
   and parameter values), timing in frames, and confidence.
4. **Not native:** anything that needs a plug-in, tracking or manual work,
   and what to do instead.

When the techniques are reusable across projects, turn them into or add them
to a skill, following `AGENTS.md`. When they are reusable *within* a project,
turn them into a template instead (`ae-ai-templates`), so the next twenty
shots are one call each.

## From breakdown to build

The breakdown is only useful if it becomes a plan:

1. Turn the beat map into a comp list — one comp per beat or scene, named
   for the beat, at the delivery size.
2. Mark which beats share a technique. Those become one template or one
   precomp used several times, not five hand-built versions.
3. Build the hardest beat first. If the signature move does not work, the
   whole plan changes, and you want to know on day one.
4. Match timing to the numbers you wrote down, then check with
   `video-reference-compare` at the same timestamps.
5. Do not copy the content. Palette, pace and technique are what you took;
   the words, logos, characters and music must be the client's own.

## Splitting the work across agents

A long film breaks down well in parallel:
- One agent runs the script and writes the beat map.
- Each other agent takes a range of beats, studies those strips, and writes
  its techniques into its own section of the write-up.
- Claim sections before starting (as in the `AGENTS.md` ownership table), so
  two agents never write the same file.
- Merge the sections at the end, with one agent verifying the risky
  techniques in After Effects.
