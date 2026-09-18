---
name: ae-audio-sync
description: Sync animation to sound in After Effects through the AE MCP Bridge - find the beats and hits in a music track (tempo, frame-snapped hit list, beat grid), place them as comp markers, cut and trigger animation on markers, drive properties from audio amplitude with Convert Audio to Keyframes, and check sync by eye and ear. Includes a cross-platform beat finder. Use when asked to cut to music, hit the beat, make something pulse or react to audio, place beat markers, or when a video feels off-beat.
---

# Audio sync

Motion that lands on the music reads as intentional; motion a frame or two
off reads as sloppy, even to people who can't say why. Get the beats as
**comp markers** first, then time everything to the markers.

## 1. Find the beats

The script next to this file reads any audio or video file with ffmpeg,
finds the hits (rises in loudness, so drums and accents), estimates the
tempo, and snaps everything to the comp's frame rate:

```
node <this skill's directory>/scripts/beats.js music.wav --fps 30
node <this skill's directory>/scripts/beats.js music.wav --fps 30 --start 0 --end 30 --json beats.json
```

It prints:
- the **tempo** in BPM, and one beat's length in seconds and in frames
- every **hit**, with its time, frame and strength (★ marks the strongest
  third)
- a **beat grid** at that tempo, phased to line up with the hits. Pass
  `--every 2` or `--every 4` for half-time or one marker per bar in 4/4

Tuning: raise `--sensitivity` (2–3) when it finds too many hits, lower it
(1–1.2) for quiet or soft tracks. `--min-gap` stops a single hit from
registering twice.

Hits follow attacks, so a smooth pad or a voice-only track gives few hits.
Then use the beat grid, or mark the phrases by listening.

## 2. Put them in the comp

`--json` writes a file ready for `ae_markers`:

```json
ae_markers {"action": "add", "markers": [{"time": 0.5, "comment": "hit"}, {"time": 1.0, "comment": "beat"}]}
```

Comp markers (no `layer`) are visible above the timeline, and expressions can
read them. Add the track to the comp too (`ae_import_file`, then
`ae_create_layer` kind `footage`), so the user hears what the markers mean.
Put it at the bottom of the stack and lock it (`locked: true`).

## 3. Time animation to the markers

- **Cuts:** trim or sequence scenes so each one starts exactly on a
  marker (`ae_set_layer_props {"inPoint": …}` or `ae_layer_action`
  `split` at the marker time). Cutting on the downbeat, the ★ hits, reads
  strongest.
- **Hits:** land the *end* of a move on the beat, not its start. A move that
  settles on the frame of the hit feels locked to the music. One that starts
  on it feels late. Start the move its own length before the marker.
- **Triggered animation:** the marker-driven expressions in `ae-expressions`
  (scale slam, decaying shake) fire on every comp marker automatically. Place
  markers, apply once, and every hit animates.
- **Anticipation:** visual accents 1–2 frames *before* the audio hit feel
  more in sync than exactly on it, because the eye is slower than the ear.
  Nudge with `ae_edit_keyframes {"shift": "-1f"}` if a hit feels late.

## 4. Drive properties from amplitude

To make something pulse with the sound, rather than on beats:

1. Select the audio layer and run
   `ae_menu_command {"command": "Convert Audio to Keyframes", "layer": "Music"}`.
   After Effects adds a null named **Audio Amplitude** with a keyframe on
   every frame, on sliders for each channel. Read its exact effect names with
   `ae_layer_detail {"layer": "Audio Amplitude", "path": ["Effects"]}`.
2. Link a property to it with an expression, and scale the value into a
   useful range. For Scale:

   ```js
   var a = thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider");
   var s = linear(a, 0, 20, 100, 130);
   [s, s]
   ```

   Keep the input range (0–20 here) matched to the loudest part of the track.
   Read the slider's keys at a peak to set it.
3. Amplitude is jittery. Smooth it with `smooth(0.1, 5)` on the slider, or
   compare against `valueAtTime(time - thisComp.frameDuration)` so only rises
   trigger.

## 5. Check sync

A contact sheet has no sound, so check the timing against the markers:

- `ae_render_frame` at each important marker. The accent should be at its
  peak or resting on that frame.
- `ae_review_motion` over a musical phrase. The motion's peaks should line up
  with the marker positions reported in `ae_selection` and `ae_markers`
  `list`.
- Recommend a real-time watch with sound before delivery. Sync is finally
  judged by ear.
