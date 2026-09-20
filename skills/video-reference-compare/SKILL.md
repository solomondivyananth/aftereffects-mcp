---
name: video-reference-compare
description: Frame-by-frame comparison of a motion-graphics or video render against a reference video. Use when matching a reference reel, checking a render against feedback that cites timecodes ("9:03 the ring is cut", "00:11 is not good"), reviewing transitions, or verifying a fix before re-rendering. Produces reference-over-candidate contact sheets at exact timestamps, at native frame rate, cropped to details, with optional difference maps.
---

# Video reference compare

Compare what was made against what it is meant to match, one frame at a time. A 2fps overview hides everything that matters in motion work: one-frame flashes, where a line starts growing, the frame a cut lands on, a glow that spreads too wide.

The tool is `scripts/refcompare.js` next to this file (in this skill's base
directory). It needs only Node and `ffmpeg`/`ffprobe`, and runs on macOS and
Windows.

```
S=<this skill's directory>/scripts/refcompare.js
node $S ref.mp4 ours.mp4 out.png --range 1.9:2.4            # every frame, native rate
node $S ref.mp4 ours.mp4 out.png --tc 9:03,21:16             # editor timecodes (s:frame)
node $S ref.mp4 ours.mp4 out.png --times 0.367 --crop 0.3:0.3:0.4:0.4 --width 640   # zoom a detail
node $S ref.mp4 ours.mp4 out.png --range 11.2:11.45 --diff   # where do they differ?
node $S ref.mp4 ours.mp4 out.png --range 13:14 --offset 0.0667   # candidate cut sits 2 frames later
```

The candidate usually comes from After Effects: render just the range in
question with `ae_render_video` (`startFrame`/`endFrame`), poll
`ae_render_status` until `done`, then compare the file it wrote.

Then Read the PNG. Each column is one timestamp: reference on top, candidate under it. The script prints which time each column is.

## Line the two files up first

A comparison is worthless if the two timelines do not mean the same thing.
Before reading a single sheet:

1. `ffprobe` both: frame rate, duration, size, and whether either has a
   start offset. Compare at the **reference's** rate.
2. Find one unmistakable event in both — a cut to black, a flash, the frame
   a logo lands — and note its time in each. The difference is your
   `--offset`, and you pass it once for every later call.
3. If the durations differ by more than a frame or two, say so: the
   candidate is either missing something or holding longer, and that is a
   finding in itself, not a nuisance to correct away.
4. Different aspect ratios cannot be compared cell by cell. Crop both to the
   common area with `--crop` and state what was cut.

## Measuring, not eyeballing

The sheet is a measuring instrument. Use it to produce numbers you can act
on:

- **Lag.** Find the first frame where the element moves in the reference,
  and the same in the candidate. The difference in frames is the lag — fix
  it with `ae_edit_keyframes {"shift": "-2f"}` rather than by feel.
- **Duration of a move.** First moving frame to first resting frame, in both.
  A move that takes 18 frames against a reference's 12 is the whole "it
  feels slow" note, expressed as a number.
- **Easing.** Equal spacing between tiles is linear; tiles bunching at the
  end mean a strong landing ease. Compare the bunching, not the poses.
- **Size and position.** Crop tight on one element in both at the same time,
  and compare where its edges sit against the cell border.

## Reading the --diff row

Bright means different; dark means the same. What is bright tells you which
kind of difference it is:

| Bright where | Usually means |
|---|---|
| Along edges only | a small offset in position, scale or timing — the shape is right |
| Over a whole shape | a colour, brightness or opacity difference |
| In a halo around something | a glow with the wrong radius or falloff |
| Everywhere, evenly | a gamma or colour-space mismatch between the two files, not a design difference |
| Only on some frames | a timing difference: the same thing happening at different moments |

That last row is the one to be careful about. A render written in a different
colour space glows bright across the whole diff and looks like a disaster; it
is a pipeline mismatch (`ae-color`), and nothing in the comp is wrong.

## Workflow

1. **Probe both files first** (`ffprobe`): frame rate, duration, size. Compare at the reference's rate. If the candidate is a different size, the tool scales both to the same cell; say so if aspect ratios differ.
2. **Translate the feedback into times.** Timecodes like `9:03` or `00:11` in an editor mean *seconds:frames*, not minutes:seconds: `9:03` = 9 s + 3 frames = 9.1 s at 30 fps; `00:11` = frame 11 = 0.367 s. Use `--tc` so the conversion is exact.
3. **Overview once, then go native.** A `--range` over the whole scene at `--fps 5` finds the region; the same region at the native rate finds the frame. Never judge motion, cuts, or flashes from the overview.
4. **Crop into details** the eye misses at full frame: glows, line endings, text alignment, matte edges. `--crop x:y:w:h` in fractions.
5. **Name the mismatch per aspect**, for each flagged time: *arrangement* (where things are), *motion* (first moving frame, direction, ease, which object leads), *effect* (glow size and falloff, blur, blend, colour), *timing* (in/out frames, cut frame). Write it down before changing anything.
6. **Fix, re-render only that range, compare the same timestamps again.** Keep the before sheet so the change is visible. A fix is done when the same `refcompare` call shows the match, not when the code looks right. In After Effects, `ae_goto` the flagged time, make the fix with the `ae_*` tools, and `ae_render_frame` at that time for a quick look before the full re-render.

## Things that usually turn out to be the problem

- **One-frame events missing.** A layer placed at 1.967 s at 30 fps starts *after* frame 59 (1.9667 s) and never shows. Snap in/out points to whole frames.
- **Something follows instead of leading.** If the reference grows a line *from* a moving dot, the dot must be driven by the line's end (e.g. AE `path.pointOnPath(trimEnd)`), not keyed separately.
- **Glows too wide or too flat.** Reference glows are usually additive and tight on the subject, with a faint wide falloff. A single big blurred shape in normal blend reads as a grey blob.
- **Clipped shapes during scale or rotation.** A fill or matte built from a frame-sized solid shows its corners once it rotates or scales. Size the fill beyond the largest extent.
- **Layout from the wrong source.** If the reference spreads elements evenly, place the elements first and build connections to them, not the other way round.

## Other jobs this tool does

- **Regression check.** Compare the new render against the *previous* one
  after a "small" fix. It is the fastest way to see what else moved.
- **Feedback with timecodes.** Turn each note into a `--tc` call and answer
  it with a sheet: the note, the frames, and what changed.
- **Format variants.** Compare the 9:16 cut against the 16:9 master at the
  same times to see what the reframe cost.

## What it cannot tell you

- **Pace and feel.** Two films can match frame for frame at every sampled
  moment and still feel different at speed. Watch them.
- **Whether your version is good.** It measures similarity, not quality. A
  perfect match to a mediocre reference is a mediocre result.
- **Mechanical faults in your own comp.** That is `ae_proof`
  (`ae-motion-proof`): the two tools answer different questions — "is it
  like the reference" and "is it broken".

## Report

Say what was compared (times, rates, crops, offset), what matched, what
still differs, and what was not checked. Give differences as numbers —
"lands 3 frames late", "glow radius about twice the reference" — not as
impressions. A contact sheet validates composition at those instants; it is
not playback. Recommend a real-time watch of the side-by-side video for
motion feel.
