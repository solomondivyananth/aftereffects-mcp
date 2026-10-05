'use strict';
/* Notes on a preview → a tweak plan, with Jev (TypeSafe's System One model).

   A person watching a preview says what's wrong in words: "the logo feels
   floaty", "everything lands late", "too bouncy". Turning that into keyframe
   edits takes two different skills, and this file keeps them apart:

   - Code reads the animation and does every number: it describes each move
     in words (how far, how long, how it eases), and later works out the exact
     edits. Jev is text-only and not a calculator, so it never sees a raw
     curve or does arithmetic.
   - Jev makes the judgments code can't: which layer the note is about, which
     tweaks it asks for, and how strongly. One request, every question asked
     in parallel, each answer typed and with a probability.

   Confident answers become edits; unsure ones become a question for the
   person. Nothing is applied here: the plan goes back to the agent, which
   applies it (one ae_batch), then previews again. */

const API = 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';

/* Thresholds for acting on an answer. Starting points, meant to be tuned on
   real notes: a Noul at 0.5 means "as likely yes as no", not "medium". */
const ACT = 0.6;       // a tweak at or above this goes in the plan
const MAYBE = 0.35;    // between MAYBE and ACT it is offered as an alternative
const TARGET_SURE = 0.55;

/* ------------------------------------------------------------------ */
/* The tweaks Jev can pick. Each is a Noul, so a note can ask for several  */
/* ("floaty and late" is faster + earlier). The wording is the question.   */
/* ------------------------------------------------------------------ */
const OPS = {
  faster: 'the motion should take less time: it feels slow, sluggish, floaty, draggy or lazy',
  slower: 'the motion should take more time: it feels rushed, too quick or hard to follow',
  harder_landing: 'moves should stop more decisively when they arrive: snappier, punchier, a firmer or more confident settle',
  softer: 'the motion should be gentler and smoother: less abrupt, less jerky, more elegant or premium',
  more_overshoot: 'the motion should overshoot or bounce more when it arrives, with more spring or life',
  less_overshoot: 'the motion should overshoot or bounce less: it is too bouncy, wobbly, springy or cartoony',
  earlier: 'the animation should happen earlier: it starts or lands too late, or waits too long before moving',
  later: 'the animation should happen later: it starts too early or arrives before it should',
  tighter_stagger: 'elements that animate one after another should be closer together in time: the cascade feels slow or like a queue',
  looser_stagger: 'elements that animate one after another should be spread further apart in time: they arrive in a clump',
  longer_hold: 'something should stay still on screen for longer: there is not enough time to read or take it in',
  shorter_hold: 'something stays still on screen too long before moving on: it lingers or drags between moves',
  motion_blur: 'fast motion looks choppy, steppy, strobey or stuttery and needs motion blur',
  smaller_move: 'something travels too far, grows too much or turns too much',
  bigger_move: 'something should travel further, grow more or turn more, because the move is too small to notice'
};
const OPPOSITES = [['faster', 'slower'], ['harder_landing', 'softer'], ['more_overshoot', 'less_overshoot'],
  ['earlier', 'later'], ['tighter_stagger', 'looser_stagger'], ['longer_hold', 'shorter_hold'], ['smaller_move', 'bigger_move']];

const AMOUNTS = [
  'A touch: the note asks for a small refinement ("a bit", "slightly", "a hair")',
  'Clearly: the note asks for a definite, noticeable change',
  'A lot: the note asks for a big change ("way too", "much", "far too", "completely")'
];

/* ------------------------------------------------------------------ */
/* Describe the animation in words (code, not the model)                */
/* ------------------------------------------------------------------ */

const TRANSFORM = /^(Position|X Position|Y Position|Z Position|Scale|Rotation|Z Rotation|X Rotation|Y Rotation|Orientation|Opacity|Anchor Point)$/;

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function vec(v) { return Array.isArray(v) ? v.filter(isNum) : (isNum(v) ? [v] : null); }
function sub(a, b) { return a.map((x, i) => x - (b[i] || 0)); }
function len(a) { return Math.sqrt(a.reduce((s, x) => s + x * x, 0)); }
function dot(a, b) { return a.reduce((s, x, i) => s + x * (b[i] || 0), 0); }
function r1(n) { return Math.round(n * 10) / 10; }

function pace(sec) {
  if (sec < 0.2) { return 'a snap'; }
  if (sec < 0.35) { return 'quick'; }
  if (sec < 0.6) { return 'moderate'; }
  if (sec < 1.0) { return 'slow'; }
  return 'very slow';
}

function easeWords(interp, influence, speed, side) {
  if (interp === 'hold') { return side === 'in' ? 'jumps to its end value (hold)' : 'jumps (hold)'; }
  if (interp === 'linear') { return side === 'in' ? 'stops dead with no ease (linear)' : 'starts abruptly at full speed (linear)'; }
  const moving = isNum(speed) && Math.abs(speed) > 0.01;
  const f = isNum(influence) ? influence : 33;
  let w;
  if (f < 25) { w = side === 'in' ? 'barely eases in' : 'barely eases out'; }
  else if (f < 55) { w = side === 'in' ? 'lands with a gentle ease' : 'eases gently out of rest'; }
  else if (f < 80) { w = side === 'in' ? 'lands with a firm ease' : 'eases firmly out of rest'; }
  else { w = side === 'in' ? 'lands with a long, strong ease' : 'builds up slowly from rest'; }
  return moving ? w + (side === 'in' ? ' but is still moving when it arrives' : ' already moving') : w;
}

function sizeWords(prop, d, minSide) {
  if (/Position|Anchor/.test(prop)) {
    const r = d / minSide;
    return (r < 0.03 ? 'a tiny' : r < 0.12 ? 'a small' : r < 0.35 ? 'a medium' : 'a large') + ' move (' + Math.round(d) + ' px)';
  }
  if (/Scale/.test(prop)) { return (d < 10 ? 'a subtle' : d < 50 ? 'a clear' : 'a big') + ' scale change (' + Math.round(d) + '%)'; }
  if (/Rotation|Orientation/.test(prop)) { return (d < 10 ? 'a slight' : d < 90 ? 'a clear' : 'a big') + ' turn (' + Math.round(d) + '°)'; }
  if (prop === 'Opacity') { return 'a fade (' + Math.round(d) + '%)'; }
  return 'a change';
}

/* Moves on one keyed property: each pair of keys whose values differ. */
function movesOf(anim, fps, minSide) {
  const prop = anim.path[anim.path.length - 1];
  const keys = anim.keys;
  const out = [];
  for (let k = 0; k + 1 < keys.length; k++) {
    const a = vec(keys[k].v), b = vec(keys[k + 1].v);
    if (!a || !b || a.length !== b.length) { continue; }
    const prop0 = anim.path[anim.path.length - 1];
    const delta = /Scale/.test(prop0) ? Math.max(...sub(b, a).map(Math.abs)) : len(sub(b, a));
    if (delta < 1e-3) { continue; }
    const sec = keys[k + 1].t - keys[k].t;
    let overshoot = false;
    if (k + 2 < keys.length) {
      const c = vec(keys[k + 2].v);
      if (c && c.length === b.length) {
        const d1 = sub(b, a), d2 = sub(c, b);
        overshoot = dot(d1, d2) < 0 && len(d2) < 0.5 * len(d1) && keys[k + 2].t - keys[k + 1].t <= 0.6;
      }
    }
    out.push({
      prop, path: anim.path, from: k + 1, to: k + 2,
      t0: keys[k].t, t1: keys[k + 1].t,
      frames: Math.round(sec * fps),
      size: delta,
      words: sizeWords(prop, delta, minSide) + ' over ' + Math.round(sec * fps) + ' frames (' + pace(sec) + '), ' +
        easeWords(keys[k].o, keys[k].fo, keys[k].so, 'out') + ', ' + easeWords(keys[k + 1].i, keys[k + 1].fi, keys[k + 1].si, 'in') +
        (overshoot ? ', then overshoots and settles back' : ''),
      overshoot,
      landing: { i: keys[k + 1].i, fi: keys[k + 1].fi }
    });
  }
  return out;
}

/* Everything the plan needs, per layer, from the proof sampler's data. */
function summarise(data) {
  const fps = data.frameRate || 30;
  const minSide = Math.min(data.width || 1920, data.height || 1080);
  const layers = [];
  for (const L of data.layers || []) {
    const anims = (L.anim || []).filter((a) => a.keys && a.keys.length > 1 && TRANSFORM.test(a.path[a.path.length - 1]));
    const moves = [];
    for (const a of anims) { moves.push(...movesOf(a, fps, minSide)); }
    moves.sort((x, y) => x.t0 - y.t0);
    const other = (L.anim || []).filter((a) => a.keys && a.keys.length > 1 && !TRANSFORM.test(a.path[a.path.length - 1]));
    if (!moves.length && !other.length) { continue; }
    /* A run is one continuous action on one property: moves that follow on
       from each other without a hold. Retiming works per run, so the holds
       between runs (and whatever comes after them) stay where they are. */
    const runs = [];
    for (const a of anims) {
      const own = moves.filter((m) => m.path === a.path);
      let cur = null;
      for (const m of own) {
        const endKey = m.overshoot ? m.to + 1 : m.to;
        if (cur && m.t0 <= cur.t1 + 1.5 / fps) {
          cur.moves.push(m);
          if (a.keys[endKey - 1].t > cur.t1) { cur.t1 = a.keys[endKey - 1].t; cur.k1 = endKey; }
        } else {
          cur = { path: a.path, t0: m.t0, t1: a.keys[endKey - 1].t, k0: m.from, k1: endKey, moves: [m] };
          runs.push(cur);
        }
      }
    }
    runs.forEach((r) => {
      const later = runs.filter((x) => x.path === r.path && x.t0 > r.t1 + 1e-6).map((x) => x.t0);
      r.next = later.length ? Math.min(...later) : null;
    });
    layers.push({
      index: L.index, name: L.name, kind: L.kind, anims, moves, runs,
      motionBlur: !!L.motionBlur,
      start: moves.length ? moves[0].t0 : null,
      other: other.map((a) => a.path.join(' ▸ '))
    });
  }
  return { fps, minSide, layers, compBlur: !!data.motionBlur };
}

/* What Jev reads. Words and named fields, filtered to what the questions
   need, since unrelated detail costs accuracy. */
function stateFor(note, sum, findings) {
  return {
    note,
    animated_layers: sum.layers.slice(0, 30).map((l) => {
      const o = { layer: l.name, type: l.kind };
      if (l.start !== null) { o.starts_moving_at = r1(l.start) + ' s'; }
      o.moves = l.moves.slice(0, 5).map((m) => m.prop + ': ' + m.words);
      if (l.other.length) { o.other_animation = l.other.slice(0, 4); }
      const f = (findings || []).filter((x) => String(x.where || '').includes(l.name)).slice(0, 5);
      if (f.length) { o.problems_found = [...new Set(f.map((x) => x.detail))]; }
      return o;
    })
  };
}

function questionsFor(sum) {
  const q = {
    about_motion: {
      type: 'noul',
      instructions: 'Is the `note` about how things move or when they move (timing, speed, easing, bounce, spacing in time, blur), rather than only about colour, wording, fonts, layout or design?'
    },
    amount: {
      type: 'score',
      instructions: 'How big a change does the `note` ask for?',
      criteria: AMOUNTS
    }
  };
  const targets = {};
  sum.layers.slice(0, 30).forEach((l, i) => { targets['layer_' + (i + 1)] = 'The layer named "' + l.name + '" (`animated_layers[' + i + ']`)'; });
  targets.everything = 'The piece as a whole, or every element, rather than one particular layer';
  targets.unclear = 'The note does not say or imply which element it means';
  q.target = { type: 'choice', instructions: 'Which element in `animated_layers` is the `note` talking about? Match names loosely: "the logo" can mean a layer named "Logo_v2".', criteria: targets };
  for (const [op, words] of Object.entries(OPS)) {
    q['op_' + op] = { type: 'noul', instructions: 'Does the `note` ask for this change: ' + words + '?' };
  }
  return q;
}

/* ------------------------------------------------------------------ */
/* Talking to Jev                                                       */
/* ------------------------------------------------------------------ */

async function systemOne(state, questions, opts = {}) {
  const key = opts.key || process.env.TYPESAFE_API_KEY;
  if (!key) { throw new Error('TYPESAFE_API_KEY is not set'); }
  const body = JSON.stringify({ state, model: opts.model || MODEL, questions });
  let wait = 500;
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 20000);
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body, signal: ctl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 3) { await new Promise((r) => setTimeout(r, wait)); wait *= 2; continue; }
      throw new Error('TypeSafe unreachable: ' + (e.name === 'AbortError' ? 'timed out' : e.message));
    }
    clearTimeout(timer);
    if ((res.status === 429 || res.status === 529) && attempt < 4) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, isFinite(after) && after > 0 ? after * 1000 : wait));
      wait *= 2;
      continue;
    }
    const text = await res.text();
    if (!res.ok) { throw new Error('TypeSafe ' + res.status + ': ' + text.slice(0, 300)); }
    return JSON.parse(text);
  }
}

/* ------------------------------------------------------------------ */
/* Judgments → edits (code again)                                       */
/* ------------------------------------------------------------------ */

const STEP = {             // per amount level 0, 1, 2
  speed: [0.85, 0.7, 0.55],
  shift: [3, 6, 10],       // frames
  landing: [75, 85, 92],   // incoming ease influence
  soft: [55, 65, 75],
  overshoot: [0.06, 0.1, 0.15],
  settle: [5, 7, 10],      // frames
  calm: [0.6, 0.35, 0],    // how much overshoot is left
  stagger: [0.75, 0.55, 0.35],
  hold: [6, 12, 20],       // frames
  travel: [0.85, 0.7, 0.55]
};

function fr(n) { return Math.round(n) + 'f'; }
function round2(v) { return Array.isArray(v) ? v.map((x) => Math.round(x * 100) / 100) : Math.round(v * 100) / 100; }

function keyedPaths(l) { return l.anims.map((a) => a.path); }

/* Keys are picked by index, not time: a plan retimes and shifts in sequence,
   and indices survive that where time windows don't. */
function range(a, b) { const o = []; for (let i = a; i <= b; i++) { o.push(i); } return o; }

function planFor(op, layers, lvl, sum) {
  const fps = sum.fps, all = sum.layers;
  const steps = [];
  const edit = (l, args, why) => steps.push({ why, tool: 'ae_edit_keyframes', args: Object.assign({ layer: l.name }, args) });
  const E = 0.001;
  if (op === 'faster' || op === 'slower') {
    for (const l of layers) {
      for (const r of l.runs) {
        let f = op === 'faster' ? STEP.speed[lvl] : 1 / STEP.speed[lvl];
        /* Stretching must not run into the next action on the same property. */
        if (f > 1 && r.next !== null && r.t1 > r.t0) { f = Math.min(f, (r.next - 2 / fps - r.t0) / (r.t1 - r.t0)); }
        if (f > 0.98 && f < 1.02) { continue; }
        const p = r.path;
        edit(l, { path: p, keys: range(r.k0, r.k1), scaleTime: round2(f) },
          (f < 1 ? 'Tighten ' : 'Stretch ') + l.name + ' ' + p[p.length - 1] + ' at ' + r1(r.t0) + ' s to ' + Math.round(f * 100) + '% of its length');
      }
    }
  } else if (op === 'earlier' || op === 'later') {
    /* "Lands late" is about the entrance: move each property's first action
       and leave later ones (an exit) where they are. */
    for (const l of layers) {
      for (const r of l.runs.filter((x) => !l.runs.some((y) => y.path === x.path && y.t0 < x.t0))) {
        let n = (op === 'earlier' ? -1 : 1) * STEP.shift[lvl];
        if (n > 0 && r.next !== null) { n = Math.min(n, Math.floor((r.next - r.t1) * fps) - 2); }
        if (n === 0) { continue; }
        edit(l, { path: r.path, keys: range(r.k0, r.k1), shift: fr(n) },
          'Move ' + l.name + ' ' + r.path[r.path.length - 1] + ' ' + Math.abs(n) + ' frames ' + (n < 0 ? 'earlier' : 'later'));
      }
    }
  } else if (op === 'harder_landing' || op === 'softer') {
    for (const l of layers) {
      const byPath = new Map();
      for (const m of l.moves) {
        const k = m.path.join('\u0000');
        if (!byPath.has(k)) { byPath.set(k, { path: m.path, landings: [], starts: [] }); }
        byPath.get(k).landings.push(m.overshoot ? m.to + 1 : m.to);
        byPath.get(k).starts.push(m.from);
      }
      for (const e of byPath.values()) {
        const path = e.path;
        const landings = [...new Set(e.landings)], starts = [...new Set(e.starts)];
        if (op === 'harder_landing') {
          edit(l, { path, keys: landings, interp: 'bezier', ease: { in: STEP.landing[lvl], inSpeed: 0 } },
            'Land ' + l.name + ' ' + path[path.length - 1] + ' with a ' + STEP.landing[lvl] + '% ease-in');
        } else {
          edit(l, { path, keys: starts, interp: 'bezier', ease: { out: STEP.soft[lvl], outSpeed: 0 } },
            'Ease ' + l.name + ' ' + path[path.length - 1] + ' out of rest (' + STEP.soft[lvl] + '%)');
          edit(l, { path, keys: landings, interp: 'bezier', ease: { in: STEP.soft[lvl] + 10, inSpeed: 0 } },
            'Soften its landing (' + (STEP.soft[lvl] + 10) + '%)');
        }
      }
    }
  } else if (op === 'more_overshoot') {
    for (const l of layers) {
      const m = l.moves.find((x) => !x.overshoot && /Position|Scale|Rotation/.test(x.prop));
      if (!m) { continue; }
      const a = l.anims.find((x) => x.path === m.path);
      const v0 = a.keys[m.from - 1].v, v1 = a.keys[m.to - 1].v;
      const f = STEP.overshoot[lvl];
      const over = Array.isArray(v1) ? v1.map((x, i) => x + (x - v0[i]) * f) : v1 + (v1 - v0) * f;
      edit(l, { path: m.path, keys: [m.to], value: round2(over), ease: { in: 60 } },
        'Overshoot ' + l.name + ' ' + m.prop + ' by ' + Math.round(f * 100) + '% of its travel');
      steps.push({ why: '…and settle back ' + STEP.settle[lvl] + ' frames later', tool: 'ae_add_keyframes',
        args: { layer: l.name, path: m.path, keys: [{ time: fr(m.t1 * fps + STEP.settle[lvl]), value: round2(v1), ease: { in: 85 } }] } });
    }
  } else if (op === 'less_overshoot') {
    for (const l of layers) {
      for (const m of l.moves.filter((x) => x.overshoot)) {
        const a = l.anims.find((x) => x.path === m.path);
        const over = a.keys[m.to - 1].v, rest = a.keys[m.to].v;
        const f = STEP.calm[lvl];
        const v = Array.isArray(over) ? over.map((x, i) => rest[i] + (x - rest[i]) * f) : rest + (over - rest) * f;
        edit(l, { path: m.path, keys: [m.to], value: round2(v) },
          f === 0 ? 'Remove the overshoot on ' + l.name + ' ' + m.prop : 'Cut the overshoot on ' + l.name + ' ' + m.prop + ' to ' + Math.round(f * 100) + '%');
      }
    }
  } else if (op === 'tighter_stagger' || op === 'looser_stagger') {
    /* The stagger is how the entrances are spaced, so only each layer's first
       action moves; its later moves (an exit) keep their time. */
    const seq = all.filter((l) => l.start !== null).sort((x, y) => x.start - y.start);
    if (seq.length > 1) {
      const f = op === 'tighter_stagger' ? STEP.stagger[lvl] : 1 / STEP.stagger[lvl];
      const t0 = seq[0].start;
      for (const l of seq.slice(1)) {
        let n = Math.round((t0 + (l.start - t0) * f - l.start) * fps);
        for (const r of l.runs.filter((x) => Math.abs(x.t0 - l.start) < 1 / fps)) {
          if (n > 0 && r.next !== null) { n = Math.min(n, Math.floor((r.next - r.t1) * fps) - 2); }
          if (n === 0) { continue; }
          edit(l, { path: r.path, keys: range(r.k0, r.k1), shift: fr(n) },
            'Re-space ' + l.name + ' ' + r.path[r.path.length - 1] + ' (' + (n > 0 ? '+' : '') + n + ' frames)');
        }
      }
    }
  } else if (op === 'longer_hold' || op === 'shorter_hold') {
    for (const l of layers) {
      let gap = null;
      for (const r of l.runs) {
        const g = r.next === null ? 0 : r.next - r.t1;
        if (g > 0.05 && (!gap || g > gap.g)) { gap = { g, next: r.next }; }
      }
      if (!gap) { continue; }
      const n = (op === 'longer_hold' ? 1 : -1) * Math.min(STEP.hold[lvl], op === 'shorter_hold' ? Math.round(gap.g * fps * 0.6) : Infinity);
      for (const a of l.anims) {
        const p = a.path;
        const first = a.keys.findIndex((k) => k.t >= gap.next - E);
        if (first < 0) { continue; }
        edit(l, { path: p, keys: range(first + 1, a.keys.length), shift: fr(n) },
          (n > 0 ? 'Hold ' : 'Shorten the hold on ') + l.name + ' ' + Math.abs(n) + ' frames ' + (n > 0 ? 'longer' : '') + ' before its next move');
      }
    }
  } else if (op === 'motion_blur') {
    for (const l of layers) {
      if (!l.motionBlur) { steps.push({ why: 'Motion blur on ' + l.name, tool: 'ae_set_layer_props', args: { layer: l.name, props: { motionBlur: true } } }); }
    }
    if (!sum.compBlur) { steps.push({ why: 'Switch on the comp\'s motion blur, or the layer switches do nothing', tool: 'ae_set_comp_settings', args: { settings: { motionBlur: true } } }); }
  } else if (op === 'smaller_move' || op === 'bigger_move') {
    const f = op === 'smaller_move' ? STEP.travel[lvl] : 1 / STEP.travel[lvl];
    for (const l of layers) {
      const m = l.moves.reduce((best, x) => (!best || x.size > best.size ? x : best), null);
      if (!m) { continue; }
      const a = l.anims.find((x) => x.path === m.path);
      const v0 = a.keys[m.from - 1].v, v1 = a.keys[m.to - 1].v;
      const v = Array.isArray(v0) ? v0.map((x, i) => v1[i] + (x - v1[i]) * f) : v1 + (v0 - v1) * f;
      edit(l, { path: m.path, keys: [m.from], value: round2(v) },
        'Start ' + l.name + ' ' + m.prop + ' ' + (f < 1 ? 'closer to' : 'further from') + ' where it lands (' + Math.round(f * 100) + '% of the travel)');
    }
  }
  return steps;
}

/* ------------------------------------------------------------------ */
/* The whole step: note + sampled comp → typed judgments → plan         */
/* ------------------------------------------------------------------ */

async function tweakPlan(note, data, findings, opts = {}) {
  const sum = summarise(data);
  if (!sum.layers.length) {
    return { note, judged: false, reason: 'Nothing in this range has keyframes to tweak (expression-driven motion is not planned here).' };
  }
  const judge = opts.systemOne || systemOne;
  const res = await judge(stateFor(note, sum, findings), questionsFor(sum), opts);
  const A = res.answers || {};

  const about = A.about_motion ? A.about_motion.noul : 1;
  const amount = A.amount ? A.amount.score : 1;
  const lvl = Math.max(0, Math.min(2, Math.round(amount)));
  const tgt = A.target || { choice: 'everything', probabilities: {}, confidence: 0 };
  const tProb = (tgt.probabilities || {})[tgt.choice] || 0;

  let ops = Object.keys(OPS).map((op) => ({ op, p: A['op_' + op] ? A['op_' + op].noul : 0 }))
    .sort((x, y) => y.p - x.p);
  const judged = {
    model: res.model,
    about_motion: r2(about),
    amount: ['a touch', 'clearly', 'a lot'][lvl] + ' (' + r2(amount) + ')',
    target: tgt.choice === 'everything' || tgt.choice === 'unclear' ? tgt.choice : sum.layers[Number(tgt.choice.split('_')[1]) - 1].name,
    target_probability: r2(tProb),
    target_confidence: r2(tgt.confidence),
    tweaks: ops.filter((o) => o.p >= MAYBE).map((o) => ({ tweak: o.op, probability: r2(o.p) }))
  };

  if (about < MAYBE) {
    return { note, judged, plan: [], ask: 'This note doesn\'t read as a timing or motion note, so there is nothing to retime. Handle it as a design change.' };
  }

  /* Opposites can't both happen: keep the likelier one. */
  const dropped = [];
  for (const [a, b] of OPPOSITES) {
    const pa = ops.find((o) => o.op === a).p, pb = ops.find((o) => o.op === b).p;
    if (pa >= ACT && pb >= ACT) { const lose = pa >= pb ? b : a; dropped.push(lose); }
  }
  const chosen = ops.filter((o) => o.p >= ACT && !dropped.includes(o.op));
  const maybe = ops.filter((o) => o.p >= MAYBE && o.p < ACT);

  /* Which layers the edits touch. A stagger is about the set, whatever the target. */
  let layers;
  let ask = null;
  if (tgt.choice === 'everything') { layers = sum.layers; }
  else if (tgt.choice === 'unclear' || tProb < TARGET_SURE) {
    const top = Object.entries(tgt.probabilities || {}).sort((x, y) => y[1] - x[1])
      .filter(([k]) => k.startsWith('layer_')).slice(0, 3).map(([k]) => sum.layers[Number(k.split('_')[1]) - 1].name);
    ask = 'Which element does the note mean' + (top.length ? ': ' + top.join(', ') + ', or everything?' : '?') +
      ' The plan below assumes ' + (top[0] ? '"' + top[0] + '"' : 'everything') + '.';
    layers = top[0] ? sum.layers.filter((l) => l.name === top[0]) : sum.layers;
  } else {
    layers = sum.layers.filter((l) => l.name === judged.target);
  }

  const plan = [];
  for (const o of chosen) { plan.push(...planFor(o.op, layers, lvl, sum)); }
  if (!chosen.length) {
    ask = (ask ? ask + ' ' : '') + (maybe.length
      ? 'Jev isn\'t sure what the note asks for. Closest: ' + maybe.map((o) => o.op.replace(/_/g, ' ')).join(', ') + '. Which one?'
      : 'The note doesn\'t map to a timing tweak this can plan. Read it and edit by hand.');
  }

  const out = { note, judged, plan };
  if (dropped.length) { out.conflicts = 'Dropped ' + dropped.join(', ') + ': the note seemed to ask for both it and its opposite.'; }
  if (maybe.length && chosen.length) { out.alternatives = maybe.map((o) => o.op.replace(/_/g, ' ') + ' (' + r2(o.p) + ')'); }
  if (ask) { out.ask = ask; }
  if (plan.length) {
    out.apply = { tool: 'ae_batch', args: { name: 'Tweak: ' + note.slice(0, 40), steps: plan.map((s) => ({ tool: s.tool, args: Object.assign({ comp: data.comp }, s.args) })) } };
    out.next = 'Nothing has changed yet. Show the plan, apply it with the ae_batch above (one undo step), then ae_review_motion again over the same range to compare.';
  }
  return out;
}

function r2(n) { return Math.round(n * 100) / 100; }

module.exports = { tweakPlan, summarise, stateFor, questionsFor, planFor, systemOne, OPS };
