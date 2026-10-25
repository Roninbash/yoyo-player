(() => {
  if (window.__floatingPlayer) return;

  const api = globalThis.browser ?? globalThis.chrome;
  const isTop = window === window.top;

  const MARGIN = 12;
  const MIN_W = 220;
  const SNAP = 24;
  const BAR = 32; // height of the drag bar above a floating embed
  const NS = 'http://www.w3.org/2000/svg';
  const MSG = '__floatingPlayer'; // marks our postMessages between frames
  const DEFAULTS = { autoFloat: true, autoPip: true };

  // Streaming sites whose players use DRM or break when their video element is moved.
  // On these we only use the browser's own picture-in-picture, which leaves the video in place.
  const PIP_ONLY_SITES = /(^|\.)(netflix\.com|primevideo\.com|amazon\.[a-z.]+|disneyplus\.com|hotstar\.com|max\.com|hbomax\.com|hulu\.com|peacocktv\.com|paramountplus\.com|tv\.apple\.com|crunchyroll\.com|sling\.com|fubo\.tv|philo\.com|starplus\.com|stan\.com\.au|jiocinema\.com|sonyliv\.com|zee5\.com|zee5\.in)$/;
  const pipOnlySite = PIP_ONLY_SITES.test(location.hostname);
  const canMove = (v) => !pipOnlySite && !v.mediaKeys && !v.webkitKeys;

  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
    muted: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9zM12 4 9.91 6.09 12 8.18z',
    popout: 'M19 11h-8v6h8zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18z',
    back: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2zM10 14h2V9.41l7.29 7.3 1.42-1.42L13.41 8H18V6h-8z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };

  const STYLE = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    .frame { position: relative; width: 100%; background: #000; border-radius: 12px; overflow: hidden;
      box-shadow: 0 14px 44px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1);
      font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
      user-select: none; -webkit-user-select: none; touch-action: none; cursor: grab; }
    .frame.dragging { cursor: grabbing; }
    .frame.window { height: 100vh; border-radius: 0; box-shadow: none; cursor: default; }
    .stage { position: relative; width: 100%; aspect-ratio: var(--ar, 16 / 9); }
    .frame.window .stage { height: 100%; aspect-ratio: auto; }
    .frame.window .resize { display: none; }
    video { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
      object-fit: contain !important; display: block !important; visibility: visible !important; opacity: 1 !important; }
    .top, .bottom { position: absolute; left: 0; right: 0; opacity: 0; pointer-events: none; transition: opacity .15s; }
    .frame:hover .top, .frame:hover .bottom, .frame:focus-within .top, .frame:focus-within .bottom,
    .frame.paused .bottom { opacity: 1; pointer-events: auto; }
    .top { top: 0; display: flex; align-items: center; gap: 2px; padding: 6px 6px 18px 12px;
      background: linear-gradient(rgba(0,0,0,.65), transparent); }
    .title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .9; }
    .bottom { bottom: 0; padding: 22px 14px 6px 8px; background: linear-gradient(transparent, rgba(0,0,0,.75)); }
    .progress { position: relative; height: 12px; margin: 0 4px 2px; cursor: pointer; }
    .track { position: absolute; left: 0; right: 0; top: 4px; height: 4px; border-radius: 2px;
      background: rgba(255,255,255,.28); overflow: hidden; transition: top .1s, height .1s; }
    .progress:hover .track { top: 3px; height: 6px; }
    .fill { height: 100%; width: 0; background: #ff3b30; }
    .row { display: flex; align-items: center; gap: 2px; }
    .time { margin-left: 6px; opacity: .9; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .spacer { flex: 1; }
    button { all: unset; width: 28px; height: 28px; flex: none; display: grid; place-items: center;
      border-radius: 6px; cursor: pointer; color: #fff; }
    button:hover { background: rgba(255,255,255,.18); }
    button:focus-visible { outline: 2px solid #fff; }
    svg { width: 18px; height: 18px; fill: currentColor; }
    [hidden] { display: none !important; }
    .resize { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
    .resize::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px;
      border-right: 2px solid rgba(255,255,255,.7); border-bottom: 2px solid rgba(255,255,255,.7); border-radius: 0 0 2px 0; }
    .frame.embed { background: transparent; box-shadow: none; border-radius: 0; overflow: visible; pointer-events: none; }
    .embed .bar { pointer-events: auto; display: flex; align-items: center; gap: 2px; height: ${BAR}px; box-sizing: border-box;
      padding: 2px 4px 2px 12px; background: #1c1c1e; border-radius: 12px 12px 0 0; box-shadow: 0 -2px 16px rgba(0,0,0,.25); }
    .embed .resize { pointer-events: auto; }
    @media (prefers-reduced-motion: reduce) { .top, .bottom, .track { transition: none; } }
  `;

  let settings = { ...DEFAULTS };
  let saved = null;    // { x, y, w } of the in-page player from last time
  let savedWin = null; // { w, h } of the pop-out window from last time
  if (isTop) {
    api.storage.sync.get(DEFAULTS).then((s) => { settings = s; updateAutoPip(); }).catch(() => {});
    api.storage.local.get(['fpPos', 'fpWin']).then((r) => { saved = r.fpPos || null; savedWin = r.fpWin || null; }).catch(() => {});
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue ?? DEFAULTS[k];
      updateAutoPip();
    });
  }
  const store = (data) => api.storage.local.set(data).catch(() => {});

  // Current session.
  //   mode: null, 'page' (floating over the page) or 'window' (popped out of the browser)
  //   kind: 'video' (we moved a <video> into our player) or 'iframe' (we pinned an embed in place)
  let mode = null, kind = null;
  let video = null, frameEl = null, frameStyle = null, frameAr = 9 / 16;
  let placeholder = null, origParent = null, origNext = null;
  let host = null, pipWin = null, ui = null, events = null;
  let autoFloated = false; // floated by scrolling; scrolling back restores it
  let autoPopped = false;  // popped out by switching tabs; coming back restores it
  const pos = { x: 0, y: 0 };
  const seen = new WeakSet();      // videos/embeds the user has actually watched on the page
  const dismissed = new WeakSet(); // closed manually; don't auto-float until scrolled back into view

  // ---------- finding videos ----------

  const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));
  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  // Custom player elements often keep their <video> in a shadow root. Chrome lets
  // extensions see closed ones too.
  const shadowOf = (n) => n.shadowRoot
    ?? (n.localName.includes('-') ? api.dom?.openOrClosedShadowRoot?.(n) ?? null : null);

  // Walking the whole DOM isn't free, so the scroll handler reuses the result for a second.
  let found = { videos: [], frames: [] };
  let foundAt = -Infinity;
  function scan(fresh = false) {
    const now = performance.now();
    if (fresh || now - foundAt > 1000) {
      found = { videos: [], frames: [] };
      collect(document, found);
      foundAt = now;
    }
    return {
      videos: found.videos.filter((v) => v.isConnected),
      frames: found.frames.filter((f) => f.isConnected),
    };
  }
  function collect(root, out) {
    out.videos.push(...root.querySelectorAll('video'));
    out.frames.push(...root.querySelectorAll('iframe'));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === host) continue;
      const shadow = shadowOf(n);
      if (shadow) collect(shadow, out);
    }
  }

  function visibleRatio(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 0;
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return (w * h) / (r.width * r.height);
  }

  function scoreOf(el, playing, muted) {
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 70) return 0;
    return r.width * r.height * (playing ? 4 : 1) * (muted ? 0.5 : 1);
  }

  function findVideo(filter = () => true) {
    let best = null, bestScore = 0;
    for (const v of scan(true).videos) {
      if ((!v.readyState && !v.currentSrc) || !filter(v)) continue;
      const score = scoreOf(v, isPlaying(v), v.muted);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  // ---------- talking to embedded frames ----------
  //
  // Every frame runs this script. A frame with a video reports it to its parent with
  // postMessage; frames in between pass their children's reports up. The top frame uses
  // the reports to float the right <iframe>.

  const childReports = new Map(); // child window -> { hasVideo, playing, muted, pip }

  function ownReport() {
    const v = findVideo();
    const r = { hasVideo: !!v, playing: !!v && isPlaying(v), muted: !!v && v.muted, pip: !!videoInPip() };
    for (const c of childReports.values()) {
      r.hasVideo ||= c.hasVideo;
      r.pip ||= c.pip;
      if (c.playing && !r.playing) Object.assign(r, { playing: true, muted: c.muted });
    }
    return r;
  }

  let lastReport = '';
  let reportTimer = 0;
  function scheduleReport() {
    if (isTop || reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = 0;
      const r = ownReport();
      const json = JSON.stringify(r);
      if (json === lastReport) return;
      lastReport = json;
      window.parent.postMessage({ [MSG]: 'report', ...r }, '*');
    }, 100);
  }

  window.addEventListener('message', (e) => {
    let d;
    try {
      d = e.data;
      if (!d || typeof d !== 'object' || !(MSG in d)) return;
    } catch {
      return;
    }
    if (d[MSG] === 'report' && e.source && e.source !== window) {
      childReports.set(e.source, {
        hasVideo: !!d.hasVideo, playing: !!d.playing, muted: !!d.muted, pip: !!d.pip,
      });
      if (isTop) onFrameReport(e.source, d);
      else scheduleReport();
    } else if (d[MSG] === 'pause' && e.source === window.parent) {
      for (const v of scan(true).videos) v.pause();
      for (const w of childReports.keys()) w.postMessage({ [MSG]: 'pause' }, '*');
    }
  });

  function onFrameReport(win, d) {
    // An embed we were floating went into the browser's picture-in-picture: put it back.
    if (mode === 'page' && kind === 'iframe' && frameEl.contentWindow === win && d.pip) restore({ manual: false });
    onScroll();
  }

  // Embeds (in the top frame) that have reported a video.
  function embedsWithVideo() {
    const out = [];
    for (const f of scan().frames) {
      const d = f.contentWindow && childReports.get(f.contentWindow);
      if (d?.hasVideo) out.push({ f, d });
    }
    return out;
  }

  // ---------- small DOM helpers ----------

  function fmt(t) {
    if (!isFinite(t)) return '0:00';
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  // Built with DOM calls rather than innerHTML so it works on Trusted Types pages like YouTube.
  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }
  function el(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
  }
  function button(name, label) {
    const b = el('button', null, icon(name));
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }
  function setIcon(b, name, label) {
    b.querySelector('path').setAttribute('d', ICONS[name]);
    b.title = label;
    b.setAttribute('aria-label', label);
  }
  function styleEl() {
    const s = document.createElement('style');
    s.textContent = STYLE;
    return s;
  }
  function setImportant(target, styles) {
    for (const [k, v] of Object.entries(styles)) target.style.setProperty(k, v, 'important');
  }

  // A same-sized stand-in so the page layout doesn't jump while the player is out.
  function makePlaceholder(target) {
    const r = target.getBoundingClientRect();
    const cs = getComputedStyle(target);
    const p = el('div', 'floating-player-placeholder', 'Playing in floating player — click to bring it back');
    Object.assign(p.style, {
      position: cs.position === 'static' || cs.position === 'fixed' ? 'relative' : cs.position,
      top: cs.top, left: cs.left, margin: cs.margin,
      width: `${r.width}px`, height: `${r.height}px`, boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '12px',
      background: '#000', color: '#aaa', font: '14px system-ui, sans-serif', cursor: 'pointer',
    });
    p.addEventListener('click', () => restore());
    return p;
  }

  // ---------- putting things back ----------

  function teardownUI() {
    events?.abort();
    ui?.frame.remove();
    host?.remove();
    host = ui = events = null;
  }

  function reattachVideo() {
    const v = video;
    if (placeholder.isConnected) placeholder.replaceWith(v);
    else if (origParent?.isConnected) origParent.insertBefore(v, origNext?.parentNode === origParent ? origNext : null);
    else v.pause(); // the page swapped out the player while we were floating
    placeholder.remove();
    video = placeholder = origParent = origNext = null;
    return v;
  }

  function unpinFrame() {
    const f = frameEl;
    if (frameStyle == null) f.removeAttribute('style');
    else f.setAttribute('style', frameStyle);
    placeholder.remove();
    frameEl = frameStyle = placeholder = null;
    return f;
  }

  function restore({ pause = false, manual = true } = {}) {
    if (!mode) return;
    const win = pipWin;
    teardownUI();
    let target;
    if (kind === 'iframe') {
      target = unpinFrame();
      if (pause) target.contentWindow?.postMessage({ [MSG]: 'pause' }, '*');
    } else {
      target = reattachVideo(); // before closing the window, or the video would go with it
      if (win && !win.closed) win.close();
      if (pause) target.pause();
    }
    if (manual && target.isConnected && visibleRatio(target) < 0.6) dismissed.add(target);
    mode = kind = pipWin = null;
    autoFloated = autoPopped = false;
  }

  function togglePlay() {
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }

  // ---------- in-page floating player ----------

  function createHost() {
    host = document.createElement('floating-player');
    setImportant(host, { position: 'fixed', 'z-index': '2147483647', display: 'block', margin: '0', padding: '0' });
    host.attachShadow({ mode: 'open' }).append(styleEl(), ui.frame);
    attachPageHandlers();
  }

  function showHost() {
    const w = clamp(saved?.w || 400, MIN_W, innerWidth - 2 * MARGIN);
    host.style.setProperty('width', `${w}px`, 'important');
    document.documentElement.append(host);
    if (kind === 'iframe') ui.hole.style.height = `${Math.round(w * frameAr)}px`;
    place(saved ? saved.x : innerWidth - w - 20, saved ? saved.y : innerHeight - host.offsetHeight - 20);
  }

  function place(x, y) {
    const maxW = innerWidth - 2 * MARGIN;
    if (host.offsetWidth > maxW) host.style.setProperty('width', `${Math.max(MIN_W, maxW)}px`, 'important');
    if (kind === 'iframe') ui.hole.style.height = `${Math.round(host.offsetWidth * frameAr)}px`;
    pos.x = clamp(x, MARGIN, innerWidth - host.offsetWidth - MARGIN);
    pos.y = clamp(y, MARGIN, innerHeight - host.offsetHeight - MARGIN);
    host.style.setProperty('left', `${pos.x}px`, 'important');
    host.style.setProperty('top', `${pos.y}px`, 'important');
    if (kind === 'iframe') pinFrame();
  }

  function snapToEdges() {
    const right = innerWidth - host.offsetWidth - MARGIN;
    const bottom = innerHeight - host.offsetHeight - MARGIN;
    let { x, y } = pos;
    if (x - MARGIN < SNAP) x = MARGIN; else if (right - x < SNAP) x = right;
    if (y - MARGIN < SNAP) y = MARGIN; else if (bottom - y < SNAP) y = bottom;
    place(x, y);
  }

  function savePos() {
    saved = { x: pos.x, y: pos.y, w: host.offsetWidth };
    store({ fpPos: saved });
  }

  function float(target, auto = false) {
    if (!isTop || mode || !target) return false;
    return target.localName === 'video' ? floatVideo(target, auto) : floatFrame(target, auto);
  }

  function floatVideo(v, auto) {
    if (!canMove(v)) return false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    placeholder = makePlaceholder(v);
    origParent = v.parentNode;
    origNext = v.nextSibling;
    video = v;
    v.replaceWith(placeholder); // moved synchronously, so it keeps playing
    mode = 'page';
    kind = 'video';
    autoFloated = auto;
    buildUI();
    createHost();
    showHost();
    return true;
  }

  // Embeds can't be moved without reloading them, so they're pinned in place with
  // position: fixed. That only works if no ancestor creates a containing block for it.
  function canPin(f) {
    for (let n = f.parentElement ?? f.getRootNode().host; n && n !== document.documentElement;
      n = n.parentElement ?? n.getRootNode().host) {
      const cs = getComputedStyle(n);
      if (cs.transform !== 'none' || cs.perspective !== 'none' || cs.filter !== 'none'
        || (cs.backdropFilter ?? cs.webkitBackdropFilter ?? 'none') !== 'none'
        || /paint|layout|strict|content/.test(cs.contain)
        || (cs.containerType ?? 'normal') !== 'normal'
        || /transform|perspective|filter/.test(cs.willChange)) return false;
    }
    return true;
  }

  function floatFrame(f, auto) {
    const r = f.getBoundingClientRect();
    if (!r.width || !r.height || !canPin(f)) return false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    placeholder = makePlaceholder(f);
    f.before(placeholder);
    frameEl = f;
    frameStyle = f.getAttribute('style');
    frameAr = r.height / r.width;
    mode = 'page';
    kind = 'iframe';
    autoFloated = auto;
    buildEmbedUI();
    createHost();
    showHost();
    return true;
  }

  function pinFrame() {
    setImportant(frameEl, {
      position: 'fixed', left: `${pos.x}px`, top: `${pos.y + BAR}px`,
      width: `${host.offsetWidth}px`, height: `${ui.hole.offsetHeight}px`,
      'z-index': '2147483646', margin: '0', border: '0', padding: '0', transform: 'none',
      'max-width': 'none', 'max-height': 'none', 'min-width': '0', 'min-height': '0',
      display: 'block', visibility: 'visible', opacity: '1', background: '#000',
      'border-radius': '0 0 12px 12px', 'box-shadow': '0 14px 44px rgba(0,0,0,.5)',
    });
  }

  function attachPageHandlers() {
    const { frame, resize } = ui;
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: events.signal });

    // Drag anywhere on the player (or an embed's bar); a press without movement toggles play.
    on(frame, 'pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .progress, .resize')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y;
      let moved = false;
      frame.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        frame.classList.add('dragging');
        place(ox + dx, oy + dy);
      };
      const up = () => {
        frame.removeEventListener('pointermove', move);
        frame.removeEventListener('pointerup', up);
        frame.removeEventListener('pointercancel', up);
        frame.classList.remove('dragging');
        if (!host) return; // closed mid-drag
        if (moved) { snapToEdges(); savePos(); } else if (kind === 'video') togglePlay();
      };
      frame.addEventListener('pointermove', move);
      frame.addEventListener('pointerup', up);
      frame.addEventListener('pointercancel', up);
    });

    on(resize, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX, ow = host.offsetWidth;
      resize.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const w = clamp(ow + ev.clientX - sx, MIN_W, innerWidth - pos.x - MARGIN);
        host.style.setProperty('width', `${w}px`, 'important');
        place(pos.x, pos.y);
      };
      const up = () => {
        resize.removeEventListener('pointermove', move);
        resize.removeEventListener('pointerup', up);
        resize.removeEventListener('pointercancel', up);
        if (host) savePos();
      };
      resize.addEventListener('pointermove', move);
      resize.addEventListener('pointerup', up);
      resize.addEventListener('pointercancel', up);
    });

    on(frame, 'keydown', (e) => {
      if (e.key === 'Escape') restore();
    });
    if (video) on(video, 'resize', () => place(pos.x, pos.y));
    on(window, 'resize', () => place(pos.x, pos.y));
  }

  // ---------- popping out of the browser ----------

  // Must run in response to a click or key press: browsers only open these windows on a user gesture.
  async function openPopOut(auto = false) {
    if (mode === 'window' || kind === 'iframe') return; // an embed pops out from inside its own frame
    const v = video || findVideo();
    if (!v) return;

    // Chrome/Edge 116+, top frame, movable video: a full window with our own controls.
    if (isTop && window.documentPictureInPicture && canMove(v)) {
      const ar = v.videoWidth && v.videoHeight ? v.videoHeight / v.videoWidth : 9 / 16;
      const width = savedWin?.w || 480;
      let win = null;
      try {
        win = await documentPictureInPicture.requestWindow({ width, height: savedWin?.h || Math.round(width * ar) });
      } catch {
        // No user gesture, or blocked by the site: fall through.
      }
      if (win) {
        teardownUI();
        if (!video) {
          placeholder = makePlaceholder(v);
          origParent = v.parentNode;
          origNext = v.nextSibling;
          video = v;
          v.replaceWith(placeholder);
        }
        mode = 'window';
        kind = 'video';
        pipWin = win;
        autoFloated = false;
        autoPopped = auto;
        buildUI();
        ui.frame.classList.add('window');
        win.document.title = document.title;
        win.document.head.append(styleEl());
        win.document.body.append(ui.frame);
        attachWindowHandlers(win);
        return;
      }
    }

    // Everything else (Safari, streaming sites, embeds, no gesture): the browser's own
    // picture-in-picture, which leaves the video where it is. If that's refused too,
    // fall back to the in-page player, whose pop-out button is a real click.
    restore({ manual: false });
    try {
      await enterVideoPip(v);
      autoPopped = auto;
    } catch {
      if (!auto) float(v);
    }
  }

  async function enterVideoPip(v) {
    v.disablePictureInPicture = false;
    if (v.requestPictureInPicture) return v.requestPictureInPicture();
    if (v.webkitSupportsPresentationMode?.('picture-in-picture')) return v.webkitSetPresentationMode('picture-in-picture');
    throw new Error('Picture-in-picture is not supported');
  }

  function videoInPip() {
    return document.pictureInPictureElement
      || scan().videos.find((v) => v.webkitPresentationMode === 'picture-in-picture')
      || null;
  }

  async function exitVideoPip() {
    const v = videoInPip();
    if (!v) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else v.webkitSetPresentationMode('inline');
  }

  function attachWindowHandlers(win) {
    const { frame } = ui;
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: events.signal });

    on(frame, 'click', (e) => {
      if (!e.target.closest('button, .progress')) togglePlay();
    });
    on(win, 'keydown', (e) => {
      if (e.target.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === ' ' || e.key === 'k') togglePlay();
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
      else if (e.key === 'ArrowRight') video.currentTime += 5;
      else if (e.key === 'm') video.muted = !video.muted;
      else return;
      e.preventDefault();
    });
    // Fires when the window is closed, including the browser's own "back to tab" button.
    win.addEventListener('pagehide', () => {
      if (win.innerWidth && win.innerHeight) {
        savedWin = { w: win.innerWidth, h: win.innerHeight };
        store({ fpWin: savedWin });
      }
      if (pipWin === win) restore();
    }, { once: true });
  }

  // ---------- player UI ----------

  function buildUI() {
    const title = el('div', 'title', document.title);
    const backBtn = button('back', 'Back to page');
    const closeBtn = button('close', 'Close (pause)');
    const playBtn = button('pause', 'Pause');
    const muteBtn = button('volume', 'Mute');
    const popBtn = button('popout', 'Pop out (stays on top of other apps)');
    const fill = el('div', 'fill');
    const progress = el('div', 'progress', el('div', 'track', fill));
    const time = el('span', 'time');
    const stage = el('div', 'stage', video);
    const resize = el('div', 'resize');
    popBtn.hidden = mode === 'window';
    progress.setAttribute('role', 'slider');
    progress.setAttribute('aria-label', 'Seek');

    const frame = el('div', 'frame',
      stage,
      el('div', 'top', title, backBtn, closeBtn),
      el('div', 'bottom', progress, el('div', 'row', playBtn, muteBtn, time, el('span', 'spacer'), popBtn)),
      resize,
    );
    ui = { frame, stage, resize, title, playBtn, muteBtn, fill, progress, time };

    events = new AbortController();
    const on = (target, type, fn) => target.addEventListener(type, fn, { signal: events.signal });

    on(playBtn, 'click', togglePlay);
    on(muteBtn, 'click', () => { video.muted = !video.muted; });
    on(backBtn, 'click', () => restore());
    on(closeBtn, 'click', () => restore({ pause: true }));
    on(popBtn, 'click', () => openPopOut());

    const seek = (ev) => {
      if (!isFinite(video.duration)) return;
      const r = progress.getBoundingClientRect();
      video.currentTime = clamp((ev.clientX - r.left) / r.width, 0, 1) * video.duration;
    };
    on(progress, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      progress.setPointerCapture(e.pointerId);
      seek(e);
      const up = () => {
        progress.removeEventListener('pointermove', seek);
        progress.removeEventListener('pointerup', up);
        progress.removeEventListener('pointercancel', up);
      };
      progress.addEventListener('pointermove', seek);
      progress.addEventListener('pointerup', up);
      progress.addEventListener('pointercancel', up);
    });

    for (const type of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'volumechange']) on(video, type, sync);
    on(video, 'loadedmetadata', updateAspect);
    on(video, 'resize', updateAspect);
    updateAspect();
    sync();
  }

  // An embed keeps its own controls; we only add a bar to drag it by and a resize corner.
  function buildEmbedUI() {
    const title = el('div', 'title', document.title);
    const backBtn = button('back', 'Back to page');
    const closeBtn = button('close', 'Close (pause)');
    const hole = el('div', 'hole');
    const resize = el('div', 'resize');
    const frame = el('div', 'frame embed', el('div', 'bar', title, backBtn, closeBtn), hole, resize);
    ui = { frame, resize, hole, title };

    events = new AbortController();
    backBtn.addEventListener('click', () => restore(), { signal: events.signal });
    closeBtn.addEventListener('click', () => restore({ pause: true }), { signal: events.signal });
  }

  function updateAspect() {
    const ar = video.videoWidth && video.videoHeight ? `${video.videoWidth} / ${video.videoHeight}` : '16 / 9';
    ui.stage.style.setProperty('--ar', ar);
  }

  function sync() {
    if (!ui?.playBtn) return;
    const paused = video.paused || video.ended;
    ui.frame.classList.toggle('paused', paused);
    setIcon(ui.playBtn, paused ? 'play' : 'pause', paused ? 'Play' : 'Pause');
    setIcon(ui.muteBtn, video.muted || !video.volume ? 'muted' : 'volume', video.muted ? 'Unmute' : 'Mute');
    const live = !isFinite(video.duration);
    const frac = live || !video.duration ? 0 : video.currentTime / video.duration;
    ui.progress.hidden = live;
    ui.progress.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    ui.time.textContent = live ? 'LIVE' : `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    ui.fill.style.width = `${frac * 100}%`;
    ui.title.textContent = document.title;
  }

  // ---------- automatic triggers (top frame) ----------

  function checkAuto() {
    if (!settings.autoFloat || mode === 'window') return;
    if (mode === 'page') {
      if (autoFloated && placeholder.isConnected && visibleRatio(placeholder) > 0.6) restore({ manual: false });
      return;
    }
    const inPip = videoInPip();
    const candidates = [
      ...scan().videos.filter(canMove).map((v) => ({ el: v, playing: isPlaying(v), muted: v.muted, pip: v === inPip })),
      ...embedsWithVideo().map(({ f, d }) => ({ el: f, ...d })),
    ];
    for (const c of candidates) {
      const vis = visibleRatio(c.el);
      if (vis > 0.6) {
        dismissed.delete(c.el);
        if (c.playing) seen.add(c.el);
        continue;
      }
      if (c.pip || dismissed.has(c.el) || !seen.has(c.el) || c.muted || !c.playing) continue;
      if (c.el.getBoundingClientRect().width >= 240 && vis < 0.25) {
        if (!float(c.el, true)) dismissed.add(c.el); // can't float this one; don't keep retrying
        return;
      }
    }
  }

  let ticking = false;
  function onScroll() {
    if (!isTop || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; checkAuto(); });
  }

  // Chrome calls this when you switch away from a tab that's playing a video.
  // Safari doesn't support it and throws, which is fine.
  function updateAutoPip() {
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', settings.autoPip ? () => openPopOut(true) : null);
    } catch {
      // Not supported in this browser.
    }
  }

  if (isTop) {
    // Capture so we also hear scrolls inside scrollable containers.
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !autoPopped) return;
      if (mode) restore({ manual: false });
      else exitVideoPip().catch(() => {});
      autoPopped = false;
    });
  }
  // Media events don't bubble, so listen in the capture phase.
  for (const type of ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'emptied',
    'enterpictureinpicture', 'leavepictureinpicture']) {
    document.addEventListener(type, () => (isTop ? onScroll() : scheduleReport()), { capture: true });
  }
  scheduleReport();

  // ---------- API for the popup and keyboard shortcuts (called via scripting.executeScript) ----------

  function status() {
    const own = findVideo();
    const embeds = isTop ? embedsWithVideo() : [];
    return {
      mode,
      pip: !!videoInPip(),
      ownVideo: !!own,
      hasVideo: !!mode || !!own || embeds.length > 0,
      // Used to choose which frame a pop-out runs in.
      score: mode === 'window' || kind === 'video' ? 1e15 : own ? scoreOf(own, isPlaying(own), own.muted) : 0,
      canFloat: isTop && (mode === 'page' || (!mode && (!!findVideo(canMove) || embeds.length > 0))),
    };
  }

  // The best thing to float in the page: a movable video, or an embed with a video.
  function floatBest() {
    const v = findVideo(canMove);
    let best = v, bestScore = v ? scoreOf(v, isPlaying(v), v.muted) : 0;
    for (const { f, d } of embedsWithVideo()) {
      const s = scoreOf(f, d.playing, d.muted);
      if (s > bestScore) { best = f; bestScore = s; }
    }
    if (best && !float(best) && best !== v && v) float(v);
  }

  window.__floatingPlayer = {
    status,
    float() {
      if (mode) restore();
      else floatBest();
      return status();
    },
    async popOut() {
      if (mode === 'window') restore();
      else if (videoInPip()) await exitVideoPip().catch(() => {});
      else await openPopOut();
      return status();
    },
  };
})();
