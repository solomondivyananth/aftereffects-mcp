---
name: ae-character-rig
description: Rig and animate a 2D cut-out character in After Effects through the AE MCP Bridge - prepare layered PSD or AI artwork (a layer per moving part, anchors on the joints, hidden surfaces filled), parent a hierarchy under a Controls null, two-bone IK arms and legs by expression with a bend-direction switch, bendy noodle limbs, blinks, gaze clipped inside the eye, head-turn parallax, mouth swaps from a pose precomp, walk cycles with overlap, and what puppet pins need a person for. Use when asked to rig a character or mascot, make it walk, blink, talk or look around, do cut-out or IK animation, or when a rigged limb pops, flips or detaches.
---

# Character rig

A cut-out rig is flat artwork on a skeleton of parented layers, with a few
expressions doing the maths. When one breaks it is nearly always one of four
things: no pixels under a joint, an anchor off the joint, layers parented
after they were keyed, or two things owning one property.

## 1. Prepare the artwork

One layer per part that moves on its own: torso, head, upper arm, forearm,
hand, thigh, shin, foot, eye whites, pupils, brows, mouth, swinging hair.
Name them in the source file; expressions read those names. Import as a
**cropped** comp, so each layer is only as big as its art (`"comp"` puts
every anchor in the middle of the document):

```json
ae_import_file {"path": "/abs/path/Character.psd", "importAs": "comp_cropped", "name": "Character"}
```

**Hidden surfaces.** Bend an elbow and you see what was under it:

- The parent part continues under the child as a **round end** centred on
  the joint, so no angle opens a gap.
- Skin under hair, neck under the jaw, body under the arms.
- **Take a moving feature's pixels out of the part below.** A mouth still
  painted on the head base becomes a frozen second mouth.

After Effects can't repaint pixels: fix the source file, then
`ae_item_action {"action": "reload", "item": "Character"}`.

**Anchors on the joints**, before parenting, while layers are unrotated at
100 %. Find the joint in comp pixels (centre of the round end; confirm with a
crosshair `ae_shape` and `ae_render_frame` at `downscale: 1`), then
`anchor += joint − position` and `position = joint`. Forearm at
[1010, 540], anchor [60, 140], elbow at [985, 430]:

```json
ae_batch {"name": "Elbow pivot", "steps": [
  {"tool": "ae_set_property", "args": {"layer": "Forearm", "path": ["Transform","Anchor Point"], "value": [35, 30]}},
  {"tool": "ae_set_property", "args": {"layer": "Forearm", "path": ["Transform","Position"], "value": [985, 430]}}]}
```

Rotate each part ±60°, render, `ae_undo`. A gap or doubled edge is an
artwork fix, not a mask.

## 2. Hierarchy and controls

Root null ▸ Hips ▸ Torso ▸ Head and Upper Arms; Upper Arm ▸ Forearm ▸ Hand;
Hips ▸ Thigh ▸ Shin ▸ Foot.

```json
ae_set_layer_props {"layers": ["Upper Arm L", "Upper Arm R", "Head"], "props": {"parent": "Torso"}}
```

**Parent first, then key.** Parenting stores the child against the parent's
*current* transform; parent to something keyed through scale 0 and the child
renders offset or not at all. Parent at rest, render, then animate.

**One Controls null** holds every knob, one `ae_add_property` per control:

```json
ae_create_layer {"kind": "null", "options": {"name": "Controls"}}
ae_batch {"name": "Rig controls", "steps": [
  {"tool": "ae_add_property", "args": {"layer": "Controls", "path": ["Effects"], "add": "ADBE Slider Control", "name": "Blink"}},
  {"tool": "ae_add_property", "args": {"layer": "Controls", "path": ["Effects"], "add": "ADBE Checkbox Control", "name": "Arm Flip"}}]}
```

Sliders used below: Blink, Look X, Look Y, Parallax, Turn Lag, Mouth, Arm
Length; checkboxes: Auto Blink, Arm Flip, Leg Flip. Add only what this
character uses.

**Leave the animator's transforms free.** Automatic motion goes on a parent
helper null or adds to `value` (`value + offset`; multiply for scale); an
expression that ignores `value` eats every key. Each automatic effect gets
an amount whose 0 gives back the original motion.

## 3. Two-bone IK

**Upper Arm** (anchor on the shoulder, parented to Torso) ▸ **Forearm**
(anchor on the elbow) ▸ **Hand** (anchor on the wrist), plus **Hand Ctrl**, a
null outside the chain (parented to Root, or Torso to follow the body). Put
Hand Ctrl on the rest wrist at rotation 0 so every bone solves to 0 at rest.
Animators key only Hand Ctrl.

It solves in the upper arm's parent space, with bone lengths from the rest
positions (so nothing is circular) and reach clamped between |a − b| and
a + b: no elbow flicker at full stretch, and the hand stops where it can reach.

Upper Arm ▸ Rotation: <!--verify-->

```js
var c = thisComp.layer("Controls");
var lo = thisComp.layer("Forearm"), hand = thisComp.layer("Hand"), ctrl = thisComp.layer("Hand Ctrl");
var flip = c.effect("Arm Flip")("Checkbox").value ? -1 : 1;
var s1 = transform.scale.value[0] / 100, s2 = lo.transform.scale.value[0] / 100;
var v1 = lo.transform.position.value - transform.anchorPoint.value;
var v2 = hand.transform.position.value - lo.transform.anchorPoint.value;
var a = length(v1) * s1, b = length(v2) * s1 * s2;
var S = transform.position.value;
var tc = ctrl.toComp(ctrl.transform.anchorPoint.value);
var T = hasParent ? parent.fromComp(tc) : tc;
var e = 0.001 * (a + b);
var d = clamp(length(T - S), Math.abs(a - b) + e, a + b - e);
var base = radiansToDegrees(Math.atan2(T[1] - S[1], T[0] - S[0]));
var alpha = radiansToDegrees(Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1)));
base + flip * alpha - radiansToDegrees(Math.atan2(v1[1], v1[0]))
```

Forearm ▸ Rotation, the same set-up solving the elbow: <!--verify-->

```js
var c = thisComp.layer("Controls");
var up = thisComp.layer("Upper Arm"), hand = thisComp.layer("Hand"), ctrl = thisComp.layer("Hand Ctrl");
var flip = c.effect("Arm Flip")("Checkbox").value ? -1 : 1;
var s1 = up.transform.scale.value[0] / 100, s2 = transform.scale.value[0] / 100;
var v1 = transform.position.value - up.transform.anchorPoint.value;
var v2 = hand.transform.position.value - transform.anchorPoint.value;
var a = length(v1) * s1, b = length(v2) * s1 * s2;
var S = up.transform.position.value;
var tc = ctrl.toComp(ctrl.transform.anchorPoint.value);
var T = up.hasParent ? up.parent.fromComp(tc) : tc;
var e = 0.001 * (a + b);
var d = clamp(length(T - S), Math.abs(a - b) + e, a + b - e);
var beta = radiansToDegrees(Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1)));
radiansToDegrees(Math.atan2(v1[1], v1[0])) - flip * (180 - beta) - radiansToDegrees(Math.atan2(v2[1], v2[0]))
```

Hand ▸ Rotation, so the hand keeps Hand Ctrl's angle whatever the forearm
does (`value` adds on top): <!--verify-->

```js
function ang(L) { var p = L.toComp([0, 0]), q = L.toComp([100, 0]); return radiansToDegrees(Math.atan2(q[1] - p[1], q[0] - p[0])); }
var r = ang(thisComp.layer("Hand Ctrl")) - ang(parent);
((r % 360) + 540) % 360 - 180 + value
```

Legs: the same three on Thigh, Shin, Foot with Foot Ctrl and Leg Flip. Keep
foot controls **out of the body's hierarchy** (parent them to Root), or a
planted foot slides whenever the hips move. The maths needs uniform scale on
every bone and no negative scale (mirror the art, use Flip instead).

**Noodle limb.** A rubber-hose arm is one stroked path
(`ae_shape {"shape": "path", "name": "Arm L", "stroke": {"width": 22, "lineCap": "round"}, …}`)
that bows to keep its length as the hand moves. On
`["Contents","Arm L","Contents","Path 1","Path"]`: <!--verify-->

```js
var c = thisComp.layer("Controls");
var sh = thisComp.layer("Shoulder L"), hc = thisComp.layer("Hand L Ctrl");
var A = fromComp(sh.toComp(sh.transform.anchorPoint.value));
var B = fromComp(hc.toComp(hc.transform.anchorPoint.value));
var L = c.effect("Arm Length")("Slider");
var flip = c.effect("Arm Flip")("Checkbox").value ? -1 : 1;
var d = Math.max(length(A, B), 0.001), dir = (B - A) / d;
var n = [-dir[1] * flip, dir[0] * flip];
var M = (A + B) / 2 + n * Math.sqrt(Math.max(0, L * L / 4 - d * d / 4));
var k = 0.3 * d;
createPath([A, M, B], [[0, 0], -dir * k, [0, 0]], [[0, 0], dir * k, [0, 0]], false)
```

## 4. Face

**Blink.** Anchor each eye white at its centre. Eye ▸ Scale, a manual Blink
slider plus an optional auto blink every 2.5–4.5 s (closes in 2 frames, opens
in 5; both eyes share the seed so they blink together): <!--verify-->

```js
var c = thisComp.layer("Controls"), f = thisComp.frameDuration;
var k = c.effect("Blink")("Slider") / 100;
if (c.effect("Auto Blink")("Checkbox").value) {
  var period = 3.5, n = Math.floor(time / period);
  seedRandom(n, true);
  var t = time - (n * period + random(0, period - 7 * f));
  var auto = t < 0 ? 0 : (t < 2 * f ? t / (2 * f) : Math.max(0, 1 - (t - 2 * f) / (5 * f)));
  k = Math.max(k, auto);
}
[value[0], value[1] * (1 - 0.95 * clamp(k, 0, 1))]
```

**Pupil clipped by the eye.** Duplicate the white as a matte, parent it to
the white (it inherits the blink) and make it the pupil's track matte.
Assigning a matte hides that layer, hence the duplicate. <!--verify--> Parent the pupil
to the Head, not the eye, or it squashes as the eye closes.

```json
ae_layer_action {"layer": "Eye L", "action": "duplicate", "name": "Eye L Matte"}
ae_set_layer_props {"layer": "Eye L Matte", "props": {"parent": "Eye L"}}
ae_set_layer_props {"layer": "Pupil L", "props": {"trackMatte": {"layer": "Eye L Matte", "type": "alpha"}}}
```

**Gaze.** Each pupil travels towards a **Look** null, clamped inside an
ellipse (eye radius minus pupil radius). Pupil ▸ Position: <!--verify-->

```js
var look = thisComp.layer("Look");
var rx = 14, ry = 9, gain = 0.12;
var tgt = parent.fromComp(look.toComp(look.transform.anchorPoint.value));
var o = (tgt - value) * gain;
var r = Math.sqrt(Math.pow(o[0] / rx, 2) + Math.pow(o[1] / ry, 2));
value + (r > 1 ? o / r : o)
```

**Head-turn parallax** from Look X / Look Y (−100 to 100). On the Position
of each face layer, the head and the back hair, changing only `depth` (nose
1, mouth 0.8, eyes 0.7, head 0.3, ears −0.4, back hair −0.8) and `follow`
(0 leads, 1 trails by Turn Lag frames). Parallax 0 returns `value` untouched;
Turn Lag 0 adds no delay: <!--verify-->

```js
var c = thisComp.layer("Controls");
var depth = 0.7, follow = 0, range = [40, 20];
var t = time - follow * c.effect("Turn Lag")("Slider") * thisComp.frameDuration;
var amt = c.effect("Parallax")("Slider") / 100;
var lx = c.effect("Look X")("Slider").valueAtTime(t) / 100;
var ly = c.effect("Look Y")("Slider").valueAtTime(t) / 100;
value + [lx * range[0], ly * range[1]] * depth * amt
```

Past about three-quarter view you need drawn turn poses.

**Mouth poses.** One mouth shape per frame in a precomp `Mouth Poses`
(0 closed, 1 A/I, 2 E, 3 O, 4 M/B/P, 5 F/V, 6 smile), a marker naming each.
The Mouth slider picks the frame:

```json
ae_set_layer_props {"layer": "Mouth", "props": {"timeRemapEnabled": true}}
ae_set_expression {"layer": "Mouth", "path": ["Time Remap"], "expression": "framesToTime(Math.round(thisComp.layer(\"Controls\").effect(\"Mouth\")(\"Slider\")))"}  <!--verify-->
```

Key the slider with `"interp": "hold"`: mouths snap, never crossfade. For
dialogue, map `ae-audio-sync` amplitude to closed / half / open first.

## 5. Cycles and overlap

**Walk in place.** Key one cycle (two steps, about 32 frames at 30 fps) on
Foot L Ctrl and add `loopOut("cycle")`. On the ground the foot slides back in
a straight line at **constant** speed (linear keys: that is the ground's
speed); the lift and swing forward get the arc and ease. Scroll the
background at stride ÷ (cycle ÷ 2) px per frame so the foot doesn't skate.

Foot R Ctrl ▸ Position, half a cycle ahead so it works from frame 0: <!--verify-->

```js
var L = thisComp.layer("Foot L Ctrl").transform.position;
L.valueAtTime(time + 16 * thisComp.frameDuration)
```

**Overlap.** Hair or a tail turns about its root to where the head was a
few frames ago. Hair ▸ Rotation (parented to Head): <!--verify-->

```js
var h = thisComp.layer("Head").transform.rotation;
value + (h.valueAtTime(time - 3 * thisComp.frameDuration) - h.value) * 0.8
```

Chain it down a tail with a growing lag; head trails torso by 2–3 frames. **No breathing, idle
sway or wiggle unless the brief or reference has it.**

## 6. Puppet pins

Bending one part's mesh (a tail, a lock of hair) needs the Puppet tool, and
**pins can't be created from a script.** Manual step for the user: select the
separated part, press Cmd/Ctrl+P (Puppet Position Pin tool) and click the
root, each bend and the tip. <!--verify--> Never puppet a flattened character.

Afterwards the agent can read and drive the pins. `ae_layer_detail` shows the
tree: Effects ▸ Puppet ▸ Mesh ▸ Mesh 1 ▸ Deform ▸ Puppet Pin 1 ▸ Position
(`ADBE FreePin3` ▸ `ADBE FreePin3 ARAP Group` ▸ `ADBE FreePin3 Mesh Group` ▸ mesh ▸ `ADBE FreePin3 PosPins` ▸ pin ▸ `ADBE FreePin3 PosPin Position`). <!--verify-->
Pins are in layer space; to follow a null: <!--verify-->

```js
var n = thisComp.layer("Tail Tip Ctrl");
fromComp(n.toComp(n.transform.anchorPoint.value))
```

Move one pin, render, `ae_undo` before binding anything. Duik, RubberHose
and Joysticks 'n Sliders are optional; nothing here needs them.

## 7. Check the rig

1. **Extremes, not rest.** Key the controls through their limits in a test
   range after the shot: Hand Ctrl past reach and on the shoulder, each
   Flip, Look X/Y ±100, Blink 100, every mouth, Parallax 0 and 100. One sheet with `ae_render_frame {"times": [...], "downscale": 1}`,
   then `ae_edit_keyframes {"keys": {"from": …, "to": …}, "delete": true}`.
2. `ae_find_animation` for `expressionError` at several times: IK that fails
   only past full reach looks fine at rest.
3. Move Root and a foot together: that catches coordinate-space mistakes.
4. `ae_review_motion` over one cycle, then `ae_proof`. Expressions leave no
   keys to measure, so say which properties are driven.

| Symptom | Fix |
|---|---|
| gap at a bending joint | round overlap in the art; anchor on the joint |
| child jumps after parenting | undo; parent at rest with no keys, then key |
| elbow bends the wrong way | tick Arm Flip |
| planted foot slides | parent the foot control to Root |
