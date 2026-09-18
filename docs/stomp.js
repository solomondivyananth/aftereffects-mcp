/*
 * stomp.js — the AE MCP Bridge welcome animation, for the web.
 *
 * A browser twin of the comp `ae_welcome` builds in After Effects: kinetic
 * "stomp" typography, one beat per claim, each backed by the real tool.
 * Deterministic — render(t) draws the frame at t seconds — so the same code
 * drives the landing page, the embeddable player, and the frame-by-frame
 * recorder that makes the README video.
 *
 *   var s = Stomp.mount(element, { accent: '#9f8cff', shake: 0.6 });
 *   s.render(3.25);
 */
(function (root) {
  'use strict';

  var DURATION = 13.5;

  var BEATS = [
    { t: 0.00, w: 'AFTER', s: 1.0 },
    { t: 0.33, w: 'EFFECTS', s: 0.9 },
    { t: 0.70, w: 'MEETS', s: 0.8, bg: 'light' },
    { t: 1.03, w: 'AI', s: 2.2, flash: true, bg: 'accent' },
    { t: 1.60, w: 'READ', s: 1.0, rot: -3 },
    { t: 1.90, w: 'EVERY', s: 1.0, rot: 2 },
    { t: 2.20, w: 'LAYER.', s: 1.05, sub: 'ae_comp_tree · ae_layer_detail', bar: true },
    { t: 2.65, w: 'SEE', s: 1.0 },
    { t: 2.95, w: 'EVERY', s: 1.0, rot: -2 },
    { t: 3.25, w: 'FRAME.', s: 1.05, sub: 'ae_render_frame · ae_review_motion', bg: 'light' },
    { t: 3.75, w: 'EDIT', s: 1.1 },
    { t: 4.05, w: 'LIVE.', s: 1.4, flash: true, bg: 'accent', sub: 'ae_set_property' },
    { t: 4.60, w: 'KEYFRAMES.', s: 0.72, sub: 'ae_edit_keyframes', fast: true },
    { t: 4.86, w: 'EXPRESSIONS.', s: 0.62, sub: 'ae_set_expression', fast: true, bg: 'light' },
    { t: 5.12, w: 'MASKS.', s: 0.95, sub: 'ae_masks', fast: true },
    { t: 5.38, w: 'SHAPES.', s: 0.9, sub: 'ae_shape', fast: true, bg: 'accent' },
    { t: 5.64, w: 'TEXT.', s: 1.05, sub: 'ae_text', fast: true },
    { t: 5.90, w: 'MARKERS.', s: 0.8, sub: 'ae_markers', fast: true, bg: 'light' },
    { t: 6.16, w: 'PRESETS.', s: 0.82, sub: 'ae_apply_preset', fast: true },
    { t: 6.60, w: 'ONE', s: 1.0 },
    { t: 6.88, w: 'UNDO', s: 1.15, bg: 'light' },
    { t: 7.16, w: 'PER', s: 1.0 },
    { t: 7.44, w: 'EDIT.', s: 1.1, sub: 'Edit ▸ Undo “MCP: …”', bar: true },
    { t: 7.95, w: '46', s: 2.4, flash: true, bg: 'accent' },
    { t: 8.45, w: 'TOOLS', s: 1.05 },
    { t: 8.80, w: '+ SKILLS', s: 0.9, bg: 'light' },
    { t: 9.25, w: 'IN YOUR', s: 0.85 },
    { t: 9.55, w: 'TIMELINE.', s: 0.85, flash: true, bar: true },
    { t: 10.15, lock: true }
  ];

  var MARKERS = [
    { t: 0, label: 'Intro' }, { t: 1.6, label: 'Read' }, { t: 2.65, label: 'See' },
    { t: 3.75, label: 'Edit' }, { t: 4.6, label: 'Tools' }, { t: 6.6, label: 'Undo' },
    { t: 7.95, label: '46' }, { t: 10.15, label: 'Lockup' }
  ];

  var CSS =
    '.stomp{position:relative;aspect-ratio:16/9;max-width:100%;overflow:hidden;background:#0e0e12;container-type:inline-size;-webkit-font-smoothing:antialiased}' +
    '.stomp *{box-sizing:border-box}.stomp [hidden]{display:none!important}' +
    '.stomp-stage{position:absolute;inset:0;display:grid;place-items:center;background:var(--st-bg,#0e0e12)}' +
    '.stomp-word{font-family:Anton,Impact,"Arial Narrow",sans-serif;color:var(--st-fg,#fff);line-height:.86;text-transform:uppercase;white-space:nowrap;text-align:center;will-change:transform}' +
    '.stomp-sub{position:absolute;left:50%;bottom:13%;transform:translateX(-50%);font:500 1.45cqw/1 "JetBrains Mono",ui-monospace,Menlo,monospace;color:var(--st-sub,#b9b2ff);letter-spacing:.04em;white-space:nowrap}' +
    '.stomp-bar{position:absolute;left:0;top:71%;width:100%;height:7%;transform-origin:left center}' +
    '.stomp-lock{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:1.6cqw;text-align:center}' +
    '.stomp-logo{font-family:Anton,Impact,"Arial Narrow",sans-serif;color:#fff;font-size:9cqw;line-height:.9;letter-spacing:.01em}' +
    '.stomp-logo span{color:var(--st-accent)}' +
    '.stomp-tag{font:500 1.45cqw/1.3 "JetBrains Mono",ui-monospace,Menlo,monospace;color:#c9c4dc;letter-spacing:.06em}' +
    '.stomp-credit{font:400 1.2cqw/1 Archivo,"Helvetica Neue",Arial,sans-serif;color:#fff;letter-spacing:.04em;margin-top:.6cqw}' +
    '.stomp-tc{position:absolute;left:1.6%;top:2.6%;font:500 1.05cqw/1 "JetBrains Mono",ui-monospace,Menlo,monospace;color:rgba(255,255,255,.5)}';

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    if (parent) { parent.appendChild(e); }
    return e;
  }

  function injectCss() {
    if (document.getElementById('stomp-css')) { return; }
    var s = el('style', null, document.head);
    s.id = 'stomp-css';
    s.textContent = CSS;
  }

  function beatAt(t) {
    for (var i = BEATS.length - 1; i >= 0; i--) { if (t >= BEATS[i].t) { return BEATS[i]; } }
    return BEATS[0];
  }

  /* Slams from big to 1 with a small overshoot. */
  function impact(local, fast) {
    var d = fast ? 0.07 : 0.1, k;
    if (local >= d * 2.2) { return 1; }
    if (local < d) { k = local / d; return 3.1 - 2.18 * (1 - Math.pow(1 - k, 3)); }
    k = (local - d) / (d * 1.2);
    return 0.92 + 0.08 * (1 - Math.pow(1 - k, 2));
  }

  function timecode(t, fps) {
    var f = Math.round(t * fps), s = Math.floor(f / fps), fr = f % fps;
    return '0:00:' + (s < 10 ? '0' : '') + s + ':' + (fr < 10 ? '0' : '') + fr;
  }

  function mount(container, opts) {
    opts = opts || {};
    injectCss();
    var accent = opts.accent || '#9f8cff';
    var shake = opts.shake === undefined ? 0.6 : opts.shake;
    var reduce = !!opts.reduceMotion;

    container.classList.add('stomp');
    container.style.setProperty('--st-accent', accent);
    var stage = el('div', 'stomp-stage', container);
    var word = el('div', 'stomp-word', stage);
    var bar = el('div', 'stomp-bar', stage);
    var sub = el('div', 'stomp-sub', stage);
    var lock = el('div', 'stomp-lock', stage);
    var logo = el('div', 'stomp-logo', lock);
    logo.innerHTML = 'AE <span>MCP</span> BRIDGE';
    el('div', 'stomp-tag', lock, '46 tools · skills · live in your timeline');
    var credit = el('div', 'stomp-credit', lock, 'by Solomon Divyananth');
    var tc = opts.timecode === false ? null : el('div', 'stomp-tc', container);

    function shakeAt(local) {
      if (reduce || !shake) { return 'none'; }
      var amp = 0.75 * shake * Math.exp(-local * 16);
      if (amp < 0.02) { return 'none'; }
      return 'translate(' + (Math.sin(local * 97) * amp).toFixed(2) + 'cqw,' + (Math.cos(local * 131) * amp * 0.7).toFixed(2) + 'cqw)';
    }

    function render(t) {
      var b = beatAt(t), local = t - b.t;
      if (tc) { tc.textContent = timecode(t, 30); }

      if (b.lock) {
        word.hidden = true; sub.hidden = true; bar.hidden = true; lock.hidden = false;
        stage.style.setProperty('--st-bg', '#0e0e12');
        var k = Math.min(1, local / 0.18);
        lock.style.transform = 'scale(' + (1.6 - 0.6 * (1 - Math.pow(1 - k, 3))) + ')';
        lock.style.opacity = String(Math.min(1, local / 0.12));
        credit.style.opacity = String(0.55 * Math.min(1, Math.max(0, (local - 0.5) / 0.4)));
        stage.style.transform = shakeAt(local);
        return;
      }
      lock.hidden = true; word.hidden = false;

      var bg = '#0e0e12', fg = '#ffffff', sfg = '#b9b2ff';
      if (b.bg === 'light') { bg = '#efedf5'; fg = '#141418'; sfg = '#4d45a8'; }
      if (b.bg === 'accent') { bg = accent; fg = '#0e0e12'; sfg = '#0e0e12'; }
      if (b.flash && local < 0.05) { bg = '#ffffff'; fg = '#0e0e12'; }
      stage.style.setProperty('--st-bg', bg);
      stage.style.setProperty('--st-fg', fg);
      stage.style.setProperty('--st-sub', sfg);

      word.textContent = b.w;
      word.style.fontSize = (20 * b.s) + 'cqw';
      var s = impact(local, b.fast);
      word.style.transform = 'scale(' + s + ') rotate(' + (b.rot || 0) + 'deg)';
      word.style.filter = s > 1.15 ? 'blur(' + Math.min(0.5, (s - 1) * 0.25) + 'cqw)' : 'none';

      sub.hidden = !b.sub || local < 0.12;
      if (b.sub) { sub.textContent = b.sub; }

      bar.hidden = !b.bar;
      if (b.bar) {
        var w = Math.min(1, Math.max(0, (local - 0.05) / 0.22));
        bar.style.transform = 'scaleX(' + (1 - Math.pow(1 - w, 3)) + ')';
        bar.style.background = b.bg === 'accent' ? '#0e0e12' : accent;
      }
      stage.style.transform = shakeAt(local);
    }

    return {
      render: render,
      duration: DURATION,
      markers: MARKERS,
      setAccent: function (c) { accent = c; container.style.setProperty('--st-accent', c); },
      setShake: function (v) { shake = v; }
    };
  }

  /* A self-running player: loops, pauses when off screen, honours reduced motion. */
  function play(container, opts) {
    opts = opts || {};
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var s = mount(container, { accent: opts.accent, shake: opts.shake, reduceMotion: reduce, timecode: opts.timecode });
    var t = reduce ? 11 : 0, speed = 1, playing = !reduce, visible = true, last = null, listeners = [];
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(container);
    }
    function frame(now) {
      if (playing && visible) {
        if (last !== null) { t += (now - last) / 1000 * speed; }
        if (t > DURATION) { t = 0; }
        last = now;
      } else { last = null; }
      s.render(t);
      for (var i = 0; i < listeners.length; i++) { listeners[i](t); }
      requestAnimationFrame(frame);
    }
    s.render(t);
    requestAnimationFrame(frame);
    return {
      stomp: s,
      get time() { return t; },
      get playing() { return playing; },
      seek: function (x) { t = Math.max(0, Math.min(DURATION, x)); },
      toggle: function () { playing = !playing; return playing; },
      replay: function () { t = 0; playing = true; },
      setSpeed: function (v) { speed = v; },
      onFrame: function (fn) { listeners.push(fn); }
    };
  }

  root.Stomp = { mount: mount, play: play, duration: DURATION, markers: MARKERS };
})(window);
