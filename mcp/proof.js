/*
 * proof.js — the motion proof-reader's rule engine.
 *
 * The panel samples a comp (bridge fn "proof"): where every layer is over
 * time, its keyframes, expressions, switches and text. This file turns that
 * into findings — the mechanical mistakes a person catches on the third
 * watch: overlaps, jitter, clipped edges, pops, unreadable text, a solo
 * switch left on.
 *
 * It never judges taste. Nothing here knows whether a move feels good.
 */
'use strict';

/* Every check, in one place: the tool lists these, the skill documents them,
   and a finding's "check" is always an id from this table. */
const CHECKS = [
  /* --- space ------------------------------------------------------- */
  { id: 'overlap', group: 'space', what: 'Two elements sit on top of each other while both are readable.' },
  { id: 'collide', group: 'space', what: 'Elements pass through each other mid-move.' },
  { id: 'clipped', group: 'space', what: 'An element is cut off by the frame edge at rest.' },
  { id: 'overshoot', group: 'space', what: 'The ease overshoots out of frame or into another element, then settles clean.' },
  { id: 'safe-area', group: 'space', what: 'Content outside title-safe (90%), or under the platform UI in 9:16.' },
  { id: 'edge-crowd', group: 'space', what: 'An element almost touches the frame edge — reads as an accident.' },
  { id: 'tangent', group: 'space', what: 'Two elements nearly touch (a few pixels apart) at rest.' },
  { id: 'text-overflow', group: 'space', what: 'Text is wider than the frame, or overflows its own text box.' },
  { id: 'text-small', group: 'space', what: 'Type too small to read at delivery size (under ~2.2% of the frame\'s short side).' },
  { id: 'text-copy', group: 'space', what: 'Copy nits: double spaces, straight quotes, trailing spaces, "..." for an ellipsis.' },
  /* --- jitter ------------------------------------------------------ */
  { id: 'jitter', group: 'jitter', what: 'A property reverses direction repeatedly by a pixel or two — chatter.' },
  { id: 'flicker', group: 'jitter', what: 'Opacity or visibility switches on and off within a few frames.' },
  { id: 'wiggle-jitter', group: 'jitter', what: 'wiggle() fast enough to read as noise, or the same seed on several layers.' },
  { id: 'sub-pixel', group: 'jitter', what: 'A slow move on fractional pixels — thin lines and type shimmer.' },
  /* --- timing ------------------------------------------------------ */
  { id: 'off-grid', group: 'timing', what: 'Keyframes off whole frames, so the move stutters.' },
  { id: 'pop', group: 'timing', what: 'A value jumps in one frame with no transition.' },
  { id: 'speed-break', group: 'timing', what: 'Incoming and outgoing speed at a keyframe differ enough to snap.' },
  { id: 'linear', group: 'timing', what: 'Transform keyframes left on linear interpolation.' },
  { id: 'read-time', group: 'timing', what: 'Text is on screen for less time than it takes to read.' },
  { id: 'stagger-drift', group: 'timing', what: 'A cascade whose offsets are uneven.' },
  { id: 'crowded-beat', group: 'timing', what: 'Four or more elements start moving in the same three frames.' },
  { id: 'dead-air', group: 'timing', what: 'A stretch longer than 1.5s where nothing moves.' },
  { id: 'unseen-keys', group: 'timing', what: 'Keyframes outside the layer\'s in/out points, or past the comp.' },
  { id: 'mid-move', group: 'timing', what: 'The range starts or ends in the middle of a move.' },
  { id: 'marker-drift', group: 'timing', what: 'Keyframes near a marker but not on it.' },
  /* --- physics ----------------------------------------------------- */
  { id: 'strobe', group: 'physics', what: 'Something moves far enough per frame to strobe, with motion blur off.' },
  { id: 'blur-switch', group: 'physics', what: 'Layer motion blur is on but the comp switch is off, or the reverse.' },
  { id: 'long-way', group: 'physics', what: 'A rotation takes the long way round between two keys.' },
  { id: 'shear', group: 'physics', what: 'A rotated parent with non-uniform scale shears its children.' },
  { id: 'upscaled', group: 'physics', what: 'Footage scaled past 100%, or vector art scaled up without continuous rasterization.' },
  /* --- integrity --------------------------------------------------- */
  { id: 'expression-error', group: 'integrity', what: 'A broken or disabled expression.' },
  { id: 'missing-footage', group: 'integrity', what: 'Footage the project cannot find.' },
  { id: 'never-visible', group: 'integrity', what: 'A layer with content that never shows in this range.' },
  { id: 'switch-left-on', group: 'integrity', what: 'Solo, shy, locked or effects-off left set by accident.' },
  { id: 'duplicate-name', group: 'integrity', what: 'Two layers with the same name — expressions and tools grab the wrong one.' },
  { id: 'comp-settings', group: 'integrity', what: 'Half resolution, work area shorter than the comp, nested comp at another frame rate.' },
  { id: 'empty-frame', group: 'integrity', what: 'The first or last frame of the range has nothing on it.' }
];

const GROUPS = {
  space: 'Space and layout',
  jitter: 'Jitter and chatter',
  timing: 'Timing and keyframes',
  physics: 'Motion physics',
  integrity: 'Render integrity'
};

const RANK = { error: 0, warn: 1, note: 2 };
const TRANSFORMS = ['Position', 'Scale', 'Rotation', 'Opacity', 'Anchor Point',
  'X Position', 'Y Position', 'Z Position', 'X Rotation', 'Y Rotation', 'Z Rotation', 'Orientation'];

const num = (n, d = 2) => Number(n.toFixed(d));
const area = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function intersection(a, b) {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  const r = Math.min(a[0] + a[2], b[0] + b[2]), t = Math.min(a[1] + a[3], b[1] + b[3]);
  if (r <= x || t <= y) { return 0; }
  return (r - x) * (t - y);
}

/* Gap between two boxes: 0 when they touch or overlap, otherwise the shortest
   distance along the axis that separates them. */
function gap(a, b) {
  const dx = Math.max(0, Math.max(a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])));
  const dy = Math.max(0, Math.max(a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3])));
  if (dx > 0 && dy > 0) { return Math.hypot(dx, dy); }
  return Math.max(dx, dy);
}

/* Consecutive sample indices → [start, end] runs. */
function runs(indices) {
  const out = [];
  for (const j of indices) {
    const last = out[out.length - 1];
    if (last && j === last[1] + 1) { last[1] = j; } else { out.push([j, j]); }
  }
  return out;
}

function analyse(d, opts = {}) {
  const W = d.width, H = d.height, fps = d.frameRate || 30;
  const S = Math.min(W, H) / 1080;
  const times = d.times || [];
  const stepFrames = times.length > 1 ? Math.max(1, Math.round((times[1] - times[0]) * fps)) : 1;
  const frame = (t) => Math.round(t * fps);
  const at = (t) => num(t) + 's/f' + frame(t);
  const span = (a, b) => (a === b ? at(a) : at(a) + '–' + at(b));

  const findings = [];
  const limits = [];
  const hot = new Set();
  const add = (check, severity, where, when, detail, fix, t) => {
    findings.push({ check, severity, where, when, detail, fix });
    if (typeof t === 'number') { hot.add(num(t)); }
  };

  const th = {
    overlap: opts.overlap || 0.12,
    rest: 0.6 * S,             // px per frame: below this a layer is at rest
    tangent: 6 * S,
    edge: 0.025 * Math.min(W, H),
    jitter: 3 * S,
    smallText: 0.022 * Math.min(W, H),   // legibility follows the short side, not the tall one
    fastPerFrame: 0.22 * W,
    deadAir: 1.5,
    readCps: 15
  };

  /* ---------------- shape the samples into paths ------------------- */
  const L = (d.layers || []).map((raw) => {
    const s = raw.samples || [];
    const box = s.map((x) => (x && x.b) ? x.b : null);
    const op = s.map((x) => (x ? (typeof x.o === 'number' ? x.o : 100) : null));
    const cen = box.map((b) => (b ? centre(b) : null));
    const vis = s.map((x, j) => !!(x && box[j] && raw.enabled !== false && !raw.guide && op[j] > 2));
    const structural = raw.kind === 'camera' || raw.kind === 'light' || raw.kind === 'null';
    const covers = box.filter(Boolean).some((b) =>
      b[0] <= 1 && b[1] <= 1 && b[0] + b[2] >= W - 1 && b[1] + b[3] >= H - 1);
    const big = box.filter(Boolean).some((b) => area(b) >= 0.8 * W * H);
    /* px per frame, between the samples we have */
    const speed = cen.map((c, j) => {
      const p = cen[j - 1];
      if (!c || !p) { return 0; }
      return dist(c, p) / stepFrames;
    });
    /* The sampler measures the real ink inside a precomp where it can. Where
       it couldn't — and for any image with an alpha channel, whose box is the
       file's whole frame, transparent margins included — the box is bigger
       than what shows, and an "overlap" may be empty space touching empty
       space. Spot it by the box still being exactly the source frame. */
    const padded = !!(raw.source && (raw.source.comp || raw.source.alpha) && raw.source.width);
    let framey = 0, framed = 0;
    s.forEach((x, j) => {
      if (!x || !box[j] || !x.s || !padded) { return; }
      framed++;
      const w = raw.source.width * x.s[0] / 100, h = raw.source.height * x.s[1] / 100;
      if (Math.abs(box[j][2] - w) < 2 && Math.abs(box[j][3] - h) < 2) { framey++; }
    });
    const frameShaped = framed > 0 && framey > framed / 2;
    /* Three things make a box bigger than what is actually on screen. Say
       which, so a finding can carry its own doubt instead of being wrong. */
    const doubt = [];
    if (frameShaped) { doubt.push(raw.source.comp ? 'measured as the whole precomp frame' : 'an image with transparent margins'); }
    if (raw.animators) { doubt.push('text animators can hide the characters'); }
    if (raw.masks) { doubt.push('masks clip it'); }
    return {
      ...raw, samples: s, box, op, cen, vis, speed, structural, frameShaped,
      doubt: doubt.length ? doubt[0] : null,
      full: covers || big,
      content: !structural && !raw.adjustment && !raw.guide && box.some(Boolean),
      keys: (raw.anim || []).filter((a) => a.keys && a.keys.length)
    };
  });
  const byIndex = new Map(L.map((l) => [l.index, l]));
  const restAt = (l, j) => l.speed[j] <= th.rest && (l.speed[j + 1] === undefined || l.speed[j + 1] <= th.rest);

  const skipped3D = L.filter((l) => l.approx && l.content);
  if (skipped3D.length && d.hasCamera) {
    limits.push('Placed by the camera, so the space rules skip them: ' + skipped3D.map((l) => l.name).join(', ') +
      '. Their boxes are flat approximations — judge those layers on rendered frames.');
  }
  if (stepFrames > 2) {
    limits.push('Sampled every ' + stepFrames + ' frames, so one-frame pops and fine jitter can hide. Re-run with more samples over a shorter range to be sure.');
  }
  const geometric = (l) => l.content && !(l.approx && d.hasCamera);

  /* ================= space ========================================= */
  const pairs = new Map();
  for (let j = 0; j < times.length; j++) {
    const live = L.filter((l) => geometric(l) && l.vis[j]);
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        const A = live[a], B = live[b];
        if (A.parent === B.index || B.parent === A.index) { continue; }
        if (A.full || B.full) { continue; }
        if (A.matte && B.index === A.index - 1) { continue; }
        if (B.matte && A.index === B.index - 1) { continue; }
        if ((A.blend && A.blend !== 'normal') || (B.blend && B.blend !== 'normal')) { continue; }
        if (A.op[j] < 25 || B.op[j] < 25) { continue; }
        const inter = intersection(A.box[j], B.box[j]);
        const smaller = Math.min(area(A.box[j]), area(B.box[j]));
        if (!smaller) { continue; }
        const frac = inter / smaller;
        const key = A.index + '|' + B.index;
        if (frac > 0.985) {
          /* One sits entirely inside the other. A card, pill or solid behind
             its own label is the whole idea; two words in the same place are
             not, so only the backdrop case is forgiven. */
          const inner = area(A.box[j]) <= area(B.box[j]) ? A : B;
          const outer = inner === A ? B : A;
          if (outer.index > inner.index && outer.kind !== 'text') { continue; }
        }
        const padded = A.doubt || B.doubt;
        if (frac >= (padded ? 0.6 : th.overlap)) {
          if (!pairs.has(key)) { pairs.set(key, { A, B, padded, hits: [] }); }
          pairs.get(key).hits.push({ j, frac, rest: restAt(A, j) && restAt(B, j) });
        } else if (frac === 0) {
          const g = gap(A.box[j], B.box[j]);
          if (g >= 2 * S && g <= th.tangent && restAt(A, j) && restAt(B, j) && !A.doubt && !B.doubt) {
            const k2 = 'T' + key;
            if (!pairs.has(k2)) { pairs.set(k2, { A, B, tangent: [] }); }
            pairs.get(k2).tangent.push({ j, g });
          }
        }
      }
    }
  }
  for (const [key, p] of pairs) {
    if (key[0] === 'T') {
      const first = p.tangent[0];
      add('tangent', 'note', p.A.name + ' + ' + p.B.name, span(times[first.j], times[p.tangent[p.tangent.length - 1].j]),
        'They stop ' + num(first.g, 1) + 'px apart — close enough to look like a mistake, far enough not to be alignment.',
        'Either align them (share an edge) or open the gap to at least ' + Math.round(12 * S) + 'px.', times[first.j]);
      continue;
    }
    const rest = p.hits.filter((h) => h.rest);
    const peak = p.hits.reduce((m, h) => (h.frac > m.frac ? h : m), p.hits[0]);
    const r = runs(p.hits.map((h) => h.j));
    const when = span(times[r[0][0]], times[r[r.length - 1][1]]);
    const held = rest.length * stepFrames / fps;
    if (rest.length && held < 0.3) {
      /* Two things in the same place for a fifth of a second is a crossfade,
         not a collision. */
      const pk = rest.reduce((m, h) => (h.frac > m.frac ? h : m), rest[0]);
      add('overlap', 'note', p.A.name + ' + ' + p.B.name, when,
        'They share the same space for ' + num(held, 2) + 's — short enough to be a crossfade.',
        'Nothing to do if they are crossing over; if one is meant to be gone by then, check its out point.', times[pk.j]);
    } else if (rest.length) {
      const pk = rest.reduce((m, h) => (h.frac > m.frac ? h : m), rest[0]);
      add('overlap', p.padded ? 'warn' : 'error', p.A.name + ' + ' + p.B.name, when,
        'They overlap by ' + Math.round(Math.min(1, pk.frac) * 100) + '% of the smaller one while both are at rest and readable.' +
        (p.padded ? ' Measured generously — ' + p.padded + ' — so render the frame before believing this one.' : ''),
        'Move one, shrink it, or stagger them in time so they are never both up.', times[pk.j]);
    } else if (peak.frac > 0.5) {
      add('collide', 'warn', p.A.name + ' + ' + p.B.name, when,
        'They pass through each other mid-move (' + Math.round(peak.frac * 100) + '% at the worst frame).',
        'Offset one path, or let the first leave before the second arrives.', times[peak.j]);
    }
  }

  for (const l of L) {
    if (!geometric(l) || l.full) { continue; }
    const out = [], overshoot = [];
    for (let j = 0; j < times.length; j++) {
      if (!l.vis[j] || !l.box[j]) { continue; }
      const b = l.box[j];
      const over = Math.max(-b[0], -b[1], (b[0] + b[2]) - W, (b[1] + b[3]) - H);
      if (over > 0.02 * Math.max(b[2], b[3]) && over > 2) {
        (restAt(l, j) ? out : overshoot).push({ j, over });
      }
    }
    if (out.length) {
      const worst = out.reduce((m, o) => (o.over > m.over ? o : m), out[0]);
      add('clipped', l.doubt ? 'warn' : 'error', l.name, span(times[out[0].j], times[out[out.length - 1].j]),
        'Cut off by the frame edge by ' + Math.round(worst.over) + 'px while it is sitting still.' +
        (l.doubt ? ' Measured generously — ' + l.doubt + ' — so the visible part may be inside.' : ''),
        'Move it inside the frame, or scale it down; if it is meant to bleed, make it cover the edge properly.', times[worst.j]);
    } else if (overshoot.length) {
      const worst = overshoot.reduce((m, o) => (o.over > m.over ? o : m), overshoot[0]);
      add('overshoot', 'warn', l.name, span(times[overshoot[0].j], times[overshoot[overshoot.length - 1].j]),
        'The ease carries it ' + Math.round(worst.over) + 'px off the frame before it settles back.',
        'Cut the overshoot (lower the incoming speed or the ease influence), or start it further inside.', times[worst.j]);
    }
  }

  const safeX = W * 0.05, safeY = H * 0.05;
  for (const l of L) {
    if (!geometric(l) || l.full) { continue; }
    if (l.kind !== 'text' && l.kind !== 'shape') { continue; }
    if (l.doubt) { continue; }
    for (let j = 0; j < times.length; j++) {
      if (!l.vis[j] || !l.box[j] || !restAt(l, j)) { continue; }
      const b = l.box[j];
      const outside = b[0] < safeX || b[1] < safeY || b[0] + b[2] > W - safeX || b[1] + b[3] > H - safeY;
      const inside = b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= W && b[1] + b[3] <= H;
      if (outside && inside) {
        add('safe-area', 'warn', l.name, at(times[j]),
          'It rests outside the title-safe 90% of the frame.',
          'Bring it inside ' + Math.round(safeX) + 'px horizontally and ' + Math.round(safeY) + 'px vertically.', times[j]);
        break;
      }
    }
    if (H > W) {
      for (let j = 0; j < times.length; j++) {
        if (!l.vis[j] || !l.box[j] || !restAt(l, j)) { continue; }
        const b = l.box[j];
        if (b[1] < H * 0.12 || b[1] + b[3] > H * 0.80) {
          add('safe-area', 'note', l.name, at(times[j]),
            'In 9:16 this sits under the platform UI (top ~12% or bottom ~20%).',
            'Keep key content between ' + Math.round(H * 0.12) + 'px and ' + Math.round(H * 0.80) + 'px.', times[j]);
          break;
        }
      }
    }
  }

  for (const l of L) {
    if (!geometric(l) || l.full || l.doubt) { continue; }
    for (let j = 0; j < times.length; j++) {
      if (!l.vis[j] || !l.box[j] || !restAt(l, j)) { continue; }
      const b = l.box[j];
      const e = Math.min(b[0], b[1], W - (b[0] + b[2]), H - (b[1] + b[3]));
      if (e > 0 && e < th.edge) {
        add('edge-crowd', 'note', l.name, at(times[j]),
          'It rests ' + Math.round(e) + 'px from the frame edge.',
          'Either give it a real margin (' + Math.round(0.05 * Math.min(W, H)) + 'px) or run it off the edge on purpose.', times[j]);
        break;
      }
    }
  }

  for (const l of L) {
    if (l.kind !== 'text' || !l.text) { continue; }
    const j = l.vis.findIndex((v, i) => v && l.box[i]);
    if (j >= 0) {
      const b = l.box[j];
      if (b[2] > W * 0.94) {
        add('text-overflow', 'error', l.name, at(times[j]),
          'The text is ' + Math.round(b[2]) + 'px wide in a ' + W + 'px frame.',
          'Shorten the copy, drop the size, or break it over two lines.', times[j]);
      }
      if (l.text.boxText && l.text.boxSize && b[3] > l.text.boxSize[1] + 2) {
        add('text-overflow', 'error', l.name, at(times[j]),
          'The paragraph overflows its text box (' + Math.round(b[3]) + 'px of text in a ' + Math.round(l.text.boxSize[1]) + 'px box).',
          'Shorten it or grow the box — overflowing text simply does not render.', times[j]);
      }
      const scale = (l.samples[j] && l.samples[j].s) ? l.samples[j].s[1] / 100 : 1;
      const onScreen = (l.text.fontSize || 0) * scale;
      if (onScreen && onScreen < th.smallText) {
        add('text-small', 'warn', l.name, at(times[j]),
          Math.round(onScreen) + 'px type in a ' + W + '×' + H + ' frame is under the ~' + Math.round(th.smallText) + 'px that stays legible on a phone.',
          'Raise the size, or accept it as texture rather than something to read.', times[j]);
      }
    }
    const s = l.text.text || '';
    const nits = [];
    if (/ {2,}/.test(s)) { nits.push('double space'); }
    if (/["']/.test(s)) { nits.push('straight quote (use “ ” ’)'); }
    if (/\.\.\./.test(s)) { nits.push('"..." (use …)'); }
    if (/^\s|\s$/.test(s)) { nits.push('leading or trailing space'); }
    if (/ ,| \./.test(s)) { nits.push('space before punctuation'); }
    if (nits.length) {
      add('text-copy', 'note', l.name, '—', 'Copy: ' + nits.join(', ') + ' — “' + s.slice(0, 60) + '”.',
        'Fix the copy with ae_text; typographic quotes and a real ellipsis read as finished work.');
    }
  }

  /* ================= jitter ======================================== */
  for (const l of L) {
    if (!l.content) { continue; }
    const series = [
      ['position', l.cen.map((c) => (c ? c[0] : null)), l.cen.map((c) => (c ? c[1] : null))],
      ['scale', l.samples.map((s) => (s && s.s ? s.s[0] : null))],
      ['rotation', l.samples.map((s) => (s && typeof s.r === 'number' ? s.r : null))]
    ];
    for (const [what, ...axes] of series) {
      for (const v of axes) {
        if (!v) { continue; }
        let reversals = 0, amp = 0, firstJ = -1, lastSign = 0;
        for (let j = 1; j < v.length; j++) {
          if (v[j] === null || v[j - 1] === null) { continue; }
          const dv = v[j] - v[j - 1];
          if (Math.abs(dv) < 1e-4) { continue; }
          const sign = Math.sign(dv);
          amp = Math.max(amp, Math.abs(dv));
          if (lastSign && sign !== lastSign) {
            reversals++;
            if (firstJ < 0) { firstJ = j; }
          }
          lastSign = sign;
        }
        const limit = what === 'rotation' ? 1.5 : th.jitter;
        if (reversals >= 4 && amp > 0 && amp < limit) {
          add('jitter', 'warn', l.name + ' ' + what, span(times[Math.max(0, firstJ - 1)], times[times.length - 1]),
            what + ' reverses direction ' + reversals + ' times by at most ' + num(amp, 2) +
            (what === 'rotation' ? '°' : 'px') + ' — that reads as chatter, not motion.',
            'Round the values, widen the keyframe spacing, or lower the wiggle amplitude so each change is at least a few pixels.',
            times[Math.max(0, firstJ - 1)]);
          break;
        }
      }
    }
    /* slow drift on fractional pixels shimmers on type and thin strokes */
    if (l.kind === 'text' || l.kind === 'shape') {
      let slow = 0, frac = false;
      for (let j = 1; j < l.speed.length; j++) {
        if (!l.vis[j]) { continue; }
        if (l.speed[j] > 0.02 && l.speed[j] < 1) {
          slow++;
          const p = l.samples[j] && l.samples[j].p;
          if (p && (Math.abs(p[0] - Math.round(p[0])) > 0.05 || Math.abs(p[1] - Math.round(p[1])) > 0.05)) { frac = true; }
        }
      }
      if (slow >= Math.max(4, times.length * 0.3) && frac) {
        add('sub-pixel', 'note', l.name, span(times[0], times[times.length - 1]),
          'It creeps under 1px per frame on fractional pixel positions — thin strokes and type shimmer doing that.',
          'Either hold it still on whole pixels, or move it fast enough (2px+ per frame) that the shimmer is hidden.');
      }
    }
  }

  for (const l of L) {
    if (!l.content) { continue; }
    let toggles = 0, firstJ = -1;
    for (let j = 1; j < l.vis.length; j++) {
      if (l.vis[j] !== l.vis[j - 1]) {
        toggles++;
        if (firstJ < 0) { firstJ = j; }
      }
    }
    if (toggles >= 3) {
      add('flicker', 'warn', l.name, span(times[Math.max(0, firstJ - 1)], times[times.length - 1]),
        'It appears and disappears ' + toggles + ' times in this range.',
        'If it is a blink, key it deliberately on whole frames; if not, check for a stray opacity key or a hold keyframe.',
        times[Math.max(0, firstJ - 1)]);
    }
  }

  const wiggles = new Map();
  for (const l of L) {
    for (const a of (l.anim || [])) {
      if (!a.expression) { continue; }
      const m = /wiggle\s*\(\s*([\d.]+)\s*,\s*([\d.]+)/.exec(a.expression);
      if (m) {
        const freq = parseFloat(m[1]), amp = parseFloat(m[2]);
        const key = a.expression.replace(/\s+/g, '');
        wiggles.set(key, (wiggles.get(key) || []).concat(l.name));
        const rot = /Rotation/i.test(a.path.join(' '));
        if (freq > 8 || (rot && freq > 4 && amp > 4)) {
          add('wiggle-jitter', 'warn', l.name + ' ' + a.path.join(' › '), '—',
            'wiggle(' + freq + ', ' + amp + ') is fast enough to read as noise rather than life.',
            'Frequency 0.5–3 for drift, up to 6 for a handheld feel; keep rotation wiggle under ~4°.');
        }
      }
    }
  }
  for (const [expr, names] of wiggles) {
    if (names.length > 1 && !/seedRandom/.test(expr)) {
      add('wiggle-jitter', 'note', names.join(', '), '—',
        'These layers share one wiggle expression with no seedRandom, so they all wobble in step.',
        'Add seedRandom(index, true) above the wiggle so each layer gets its own phase.');
    }
  }

  /* ================= timing ======================================== */
  const firstMove = [];
  const allKeyTimes = [];
  for (const l of L) {
    for (const a of l.keys) {
      const isTransform = a.path.some((p) => TRANSFORMS.includes(p));
      const label = l.name + ' ' + a.path.join(' › ');
      let linear = 0;
      for (let i = 0; i < a.keys.length; i++) {
        const k = a.keys[i], next = a.keys[i + 1];
        allKeyTimes.push(k.t);
        if (Math.abs(k.t * fps - Math.round(k.t * fps)) > 0.05) {
          add('off-grid', 'warn', label, at(k.t),
            'Keyframe at ' + num(k.t, 3) + 's is ' + num(Math.abs(k.t * fps - Math.round(k.t * fps)), 2) + ' of a frame off the grid.',
            'Snap it to a whole frame — After Effects renders the frame, not the in-between.', k.t);
        }
        if (k.t < l.inPoint - 1.5 / fps || k.t > l.outPoint + 1.5 / fps) {
          add('unseen-keys', 'note', label, at(k.t),
            'This keyframe is outside the layer\'s in/out points, so nobody sees it.',
            'Trim the keys or extend the layer — whichever you meant.', k.t);
        }
        if (k.t > d.duration + 1e-6) {
          add('unseen-keys', 'warn', label, at(k.t), 'This keyframe is past the end of the comp.',
            'Shorten the animation or lengthen the comp.', k.t);
        }
        if (next && isTransform) {
          const dt = (next.t - k.t) * fps;
          const jump = Array.isArray(k.v) && Array.isArray(next.v)
            ? Math.hypot(...next.v.map((n, ii) => n - k.v[ii]))
            : Math.abs((next.v || 0) - (k.v || 0));
          const big = a.path.includes('Opacity') ? jump > 60 : (a.path.includes('Scale') ? jump > 40 : jump > 0.2 * W);
          if (dt <= 1.5 && big && !(l.motionBlur && d.motionBlur)) {
            add('pop', 'warn', label, span(k.t, next.t),
              'The value jumps by ' + num(jump, 1) + ' in ' + num(dt, 1) + ' frame(s), with no motion blur to cover it.',
              'Either give it 3+ frames, or make the cut deliberate (hold keyframes), or switch motion blur on.', k.t);
          }
          if (dt >= 5 && k.o === 'linear' && next.i === 'linear' && !a.expression && jump > 0) { linear++; }
        }
        if (i > 0 && next && typeof k.si === 'number' && typeof k.so === 'number') {
          const lo = Math.min(Math.abs(k.si), Math.abs(k.so)), hi = Math.max(Math.abs(k.si), Math.abs(k.so));
          if (lo > 0.5 && hi / lo > 3) {
            add('speed-break', 'note', label, at(k.t),
              'Speed changes from ' + num(k.si, 1) + ' to ' + num(k.so, 1) + ' across this keyframe — it snaps.',
              'Match the speeds (or hold at zero) so the move carries through.', k.t);
          }
        }
      }
      if (linear >= 1) {
        add('linear', 'note', label, span(a.keys[0].t, a.keys[a.keys.length - 1].t),
          linear + ' keyframe span(s) of 5+ frames are still linear.',
          'Ease them (ae-motion-principles: 75–90 landing ease) unless the move is a constant-speed loop.', a.keys[0].t);
      }
      if (isTransform && a.keys.length) { firstMove.push({ layer: l, t: a.keys[0].t }); }
      if (a.path.some((p) => /Rotation|Orientation/.test(p))) {
        for (let i = 1; i < a.keys.length; i++) {
          const dv = Math.abs((a.keys[i].v || 0) - (a.keys[i - 1].v || 0));
          if (dv > 180 && dv < 360) {
            add('long-way', 'note', label, span(a.keys[i - 1].t, a.keys[i].t),
              'Rotation moves ' + Math.round(dv) + '°, so it spins the long way round.',
              'Use the short way (' + Math.round(360 - dv) + '° the other direction) unless the long spin is the point.', a.keys[i - 1].t);
          }
        }
      }
    }
    for (const a of (l.anim || [])) {
      if (a.expressionError) {
        add('expression-error', 'error', l.name + ' ' + a.path.join(' › '), '—',
          'Expression error: ' + String(a.expressionError).replace(/\s+/g, ' ').slice(0, 160),
          'Fix or clear it — a broken expression freezes the property at its last good value and renders wrong.');
      } else if (a.expressionEnabled === false) {
        add('expression-error', 'note', l.name + ' ' + a.path.join(' › '), '—',
          'An expression is present but switched off.',
          'Turn it back on or clear it, so the file says what it means.');
      }
    }
  }

  /* text needs long enough to read */
  for (const l of L) {
    if (l.kind !== 'text' || !l.text || !l.text.text) { continue; }
    const on = l.vis.map((v, j) => (v && l.op[j] > 50 ? times[j] : null)).filter((t) => t !== null);
    if (!on.length) { continue; }
    const held = on[on.length - 1] - on[0] + stepFrames / fps;
    const chars = l.text.text.replace(/\s+/g, ' ').length;
    const need = Math.max(0.8, chars / th.readCps + 0.4);
    const wholeRange = on[0] <= times[0] + 1e-6 && on[on.length - 1] >= times[times.length - 1] - 1e-6;
    if (held + 1e-6 < need && !wholeRange) {
      add('read-time', 'warn', l.name, span(on[0], on[on.length - 1]),
        chars + ' characters are up for ' + num(held, 2) + 's; reading them takes about ' + num(need, 1) + 's.',
        'Hold it longer, cut the copy, or split it across two beats.', on[0]);
    }
  }

  /* cascades: even offsets or not */
  firstMove.sort((a, b) => a.t - b.t);
  let group = [];
  const flushGroup = () => {
    if (group.length >= 3) {
      const offs = [];
      for (let i = 1; i < group.length; i++) { offs.push((group[i].t - group[i - 1].t) * fps); }
      const lo = Math.min(...offs), hi = Math.max(...offs);
      if (hi - lo > 1.2 && hi < 12) {
        add('stagger-drift', 'note', group.map((g) => g.layer.name).join(', '), span(group[0].t, group[group.length - 1].t),
          'The cascade steps by ' + offs.map((o) => num(o, 1)).join(', ') + ' frames — uneven.',
          'Give every step the same offset (ae_layer_action sequence, or copyTo with a fixed offset).', group[0].t);
      }
      if (group.length >= 4 && (group[group.length - 1].t - group[0].t) * fps <= 3) {
        add('crowded-beat', 'note', group.map((g) => g.layer.name).join(', '), at(group[0].t),
          group.length + ' elements start moving inside 3 frames.',
          'One thing at a time reads better: stagger them 3–5 frames apart, or move them as one group.', group[0].t);
      }
    }
    group = [];
  };
  for (const m of firstMove) {
    if (!group.length || (m.t - group[group.length - 1].t) * fps <= 12) { group.push(m); } else { flushGroup(); group = [m]; }
  }
  flushGroup();

  /* Dead air — but only when the comp really is still. Expressions move
     without keyframes, and a precomp or a video clip carries its own motion
     that this comp's keyframes know nothing about. */
  const movesInvisibly = L.some((l) => (l.anim || []).some((a) => a.expression && !a.expressionError)) ||
    L.some((l) => l.vis.some(Boolean) && l.source && (l.source.comp || (l.source.file && !l.source.still)));
  if (!movesInvisibly && allKeyTimes.length) {
    const sorted = [...new Set(allKeyTimes)].sort((a, b) => a - b);
    const edges = [times[0], ...sorted, times[times.length - 1]];
    for (let i = 1; i < edges.length; i++) {
      const g = edges[i] - edges[i - 1];
      if (g > th.deadAir) {
        add('dead-air', 'note', d.comp, span(edges[i - 1], edges[i]),
          num(g, 1) + 's with nothing moving.',
          'Either trim it, or give the hold a reason (a slow drift, a camera push) so it reads as a beat, not a stall.', edges[i - 1]);
      }
    }
  }

  /* starts or ends mid-move */
  for (const l of L) {
    for (const a of l.keys) {
      if (!a.path.some((p) => TRANSFORMS.includes(p))) { continue; }
      const first = a.keys[0].t, last = a.keys[a.keys.length - 1].t;
      const label = l.name + ' ' + a.path.join(' › ');
      if (first < times[0] - 1e-6 && last > times[0] + 1e-6) {
        add('mid-move', 'note', label, at(times[0]), 'The range starts in the middle of this move.',
          'If this is the whole piece, start from a rest pose; if it is a section, ignore this.', times[0]);
      }
      if (first < times[times.length - 1] - 1e-6 && last > times[times.length - 1] + 1e-6) {
        add('mid-move', 'warn', label, at(times[times.length - 1]), 'The range ends in the middle of this move.',
          'Land the move before the end, or extend the comp/work area — an end card should be still.', times[times.length - 1]);
      }
    }
  }

  /* markers the keys nearly hit */
  for (const m of (d.markers || [])) {
    for (const l of L) {
      for (const a of l.keys) {
        for (const k of a.keys) {
          const off = Math.abs(k.t - m.t) * fps;
          if (off > 0.5 && off <= 4) {
            add('marker-drift', 'note', l.name + ' ' + a.path.join(' › '), at(k.t),
              'This key is ' + num(off, 1) + ' frames off the marker "' + (m.comment || num(m.t, 2) + 's') + '".',
              'Snap it to the marker if it is meant to hit that beat.', m.t);
          }
        }
      }
    }
  }

  /* ================= physics ======================================= */
  for (const l of L) {
    if (!l.content) { continue; }
    let worst = 0, worstJ = -1;
    for (let j = 1; j < l.speed.length; j++) {
      if (!l.vis[j] || !l.box[j]) { continue; }
      const limit = Math.max(0.6 * l.box[j][2], th.fastPerFrame);
      if (l.speed[j] > limit && l.speed[j] > worst) { worst = l.speed[j]; worstJ = j; }
    }
    if (worstJ >= 0 && !(l.motionBlur && d.motionBlur)) {
      add('strobe', 'warn', l.name, at(times[worstJ]),
        'It travels about ' + Math.round(worst) + 'px per frame with motion blur ' +
        (d.motionBlur ? 'off on the layer' : 'off in the comp') + ' — fast enough to strobe.',
        'Switch motion blur on (layer and comp), or slow the move down.', times[worstJ]);
    }
    if (l.motionBlur && !d.motionBlur) {
      add('blur-switch', 'note', l.name, '—', 'Layer motion blur is on but the comp switch is off, so it does nothing.',
        'Turn the comp\'s motion blur switch on, or clear the layer switch.');
    }
    if (l.parent) {
      const p = byIndex.get(l.parent);
      const j = l.vis.findIndex(Boolean);
      const ps = p && j >= 0 ? p.samples[j] : null;
      if (ps && ps.s && ps.r && Math.abs(ps.r) > 0.5 && Math.abs(ps.s[0] - ps.s[1]) > 1) {
        add('shear', 'warn', l.name, at(times[j]),
          'Its parent "' + p.name + '" is rotated ' + num(ps.r, 1) + '° with non-uniform scale (' +
          num(ps.s[0], 1) + '%, ' + num(ps.s[1], 1) + '%), which shears everything under it.',
          'Make the parent scale uniform and scale the child instead.', times[j]);
      }
    }
    const src = l.source;
    if (src && src.file && !src.comp) {
      const j = l.vis.findIndex(Boolean);
      const s = j >= 0 ? l.samples[j] : null;
      if (s && s.s && Math.max(s.s[0], s.s[1]) > 105) {
        add('upscaled', 'note', l.name, at(times[j]),
          'Footage "' + src.name + '" is scaled to ' + Math.round(Math.max(s.s[0], s.s[1])) + '% — past its own pixels.',
          'Use a larger source, or keep it under 100%. Vector art needs continuous rasterization instead.', times[j]);
      }
    }
    if (src && src.comp && !l.collapse) {
      const j = l.vis.findIndex(Boolean);
      const s = j >= 0 ? l.samples[j] : null;
      if (s && s.s && Math.max(s.s[0], s.s[1]) > 110) {
        add('upscaled', 'note', l.name, at(times[j]),
          'A precomp scaled to ' + Math.round(Math.max(s.s[0], s.s[1])) + '% without Collapse Transformations renders soft.',
          'Switch collapse on, or build the precomp at the size it is used.', times[j]);
      }
    }
  }

  /* ================= integrity ===================================== */
  for (const name of (d.missingFootage || [])) {
    add('missing-footage', 'error', name, '—', 'The project cannot find this footage.',
      'Relink it before rendering — it renders as a colour bar placeholder.');
  }
  const names = new Map();
  for (const l of L) {
    names.set(l.name, (names.get(l.name) || 0) + 1);
    if (l.solo) {
      add('switch-left-on', 'error', l.name, '—', 'Solo is on, so only soloed layers render.',
        'Turn solo off before rendering.');
    }
    if (l.shy) {
      add('switch-left-on', 'note', l.name, '—', 'Shy is on — the layer is hidden in the timeline, not in the render.',
        'Harmless, but it hides work from whoever opens this next.');
    }
    if (l.effectsActive === false && l.effects && l.effects.length) {
      add('switch-left-on', 'warn', l.name, '—', 'The layer\'s effects switch is off, so its ' + l.effects.length + ' effect(s) do nothing.',
        'Turn it back on, or delete the effects.');
    }
    for (const fx of (l.effects || [])) {
      if (fx.on === false) {
        add('switch-left-on', 'note', l.name + ' › ' + fx.name, '—', 'This effect is disabled.',
          'Enable it or remove it.');
      }
    }
    if (l.content && !l.vis.some(Boolean)) {
      const why = l.enabled === false ? 'its eyeball is off'
        : (l.op.every((o) => o === null || o <= 2) ? 'its opacity never rises above 2%' : 'it is outside this range');
      add('never-visible', l.enabled === false ? 'warn' : 'note', l.name, '—',
        'Never visible here — ' + why + '.',
        'Delete it, or make it visible if it was meant to show.');
    }
  }
  for (const [name, n] of names) {
    if (n > 1) {
      add('duplicate-name', 'warn', name + ' ×' + n, '—',
        n + ' layers share the name "' + name + '".',
        'Rename them — expressions and every name-based tool grab the first match.');
    }
  }
  if (d.resolution && (d.resolution[0] !== 1 || d.resolution[1] !== 1)) {
    add('comp-settings', 'warn', d.comp, '—',
      'The comp is set to 1/' + d.resolution[0] + ' resolution.',
      'Set it back to Full before judging quality or rendering.');
  }
  if (d.workArea && Math.abs(d.workArea[1] - d.duration) > 1 / fps) {
    add('comp-settings', 'note', d.comp, span(d.workArea[0], d.workArea[0] + d.workArea[1]),
      'The work area (' + num(d.workArea[1], 2) + 's) is not the whole comp (' + num(d.duration, 2) + 's).',
      'Renders and previews use the work area — set it deliberately.');
  }
  for (const l of L) {
    if (l.source && l.source.comp && Math.abs(l.source.fps - fps) > 0.01) {
      add('comp-settings', 'warn', l.name, '—',
        'Precomp "' + l.source.name + '" runs at ' + l.source.fps + 'fps inside a ' + fps + 'fps comp.',
        'Match the frame rates, or its motion judders.');
    }
  }
  for (const edge of [0, times.length - 1]) {
    if (times.length && !L.some((l) => l.content && l.vis[edge])) {
      add('empty-frame', 'error', d.comp, at(times[edge]),
        (edge === 0 ? 'The first frame' : 'The last frame') + ' of the range has nothing visible on it.',
        'Extend a background or the first element — an empty frame renders transparent (white in most players).', times[edge]);
    }
  }

  /* ---------------- shape the report ------------------------------- */
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] ||
    a.check.localeCompare(b.check) || String(a.where).localeCompare(String(b.where)));
  const counts = { error: 0, warn: 0, note: 0 };
  for (const f of findings) { counts[f.severity]++; }
  const cap = opts.limit || 60;
  const shown = findings.slice(0, cap);

  return {
    comp: d.comp,
    size: W + '×' + H,
    fps,
    range: at(times[0] || 0) + ' → ' + at(times[times.length - 1] || 0) +
      ' · ' + times.length + ' samples every ' + stepFrames + ' frame(s)',
    counts,
    verdict: counts.error ? 'errors to fix' : (counts.warn ? 'worth a look' : (counts.note ? 'clean, with notes' : 'clean')),
    findings: shown,
    truncated: findings.length > shown.length ? findings.length - shown.length : undefined,
    look_at: [...hot].sort((a, b) => a - b).slice(0, 12),
    limits: limits.length ? limits : undefined,
    screened: CHECKS.length + ' checks in ' + Object.keys(GROUPS).length + ' groups (ae_proof {"action":"checks"})'
  };
}

module.exports = { analyse, CHECKS, GROUPS };
