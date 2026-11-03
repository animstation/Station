// Animator workstation: gallery + editor with filmstrip, layers, color swap tool, WebGL shaders.
// Project = { id, name, updated, fps, layers: [{ id, name, vis, fill? }], frames }
// frames[i] = strokes [{ l: layerId, color, size, pts }]  (layers listed bottom to top)

const showError = msg => {
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'Error: ' + msg; t.classList.add('on'); }
};
window.addEventListener('error', e => showError(e.message));
window.addEventListener('unhandledrejection', e => showError(e.reason && e.reason.message || 'something failed'));
const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);
const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls || ''; return e; };
let W = 720, H = 1040;
const KEY = 'animator.projects', AKEY = 'animator.assets';
const PALETTE = ['#000000', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const FX = ['Off', 'Soft', 'CRT', 'Noir', 'Pixel', 'Wobble', 'Chroma'];

const draw = $('draw'), onion = $('onion'), ref = $('ref'), fxc = $('fx'), uic = $('ui');
const dctx = draw.getContext('2d'), octx = onion.getContext('2d'), uctx = uic.getContext('2d');
for (const c of [draw, onion, fxc, uic]) { c.width = W; c.height = H; }

let projects = loadAll(), assets = loadAssets(), proj = null, activeL = 1, hist = [], sel = null, drag = null, clip = {};
let cur = 0, fps = 12, playing = false, timer = null, onionOn = true, stroke = null, saveT = null, tool = 'brush';

// ---------- storage ----------
function loadAll() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { /* ignore */ }
  for (const p of list) {                       // upgrade older projects
    p.layers = p.layers || [{ id: 1, name: 'Layer 1', vis: true }];
    p.w = p.w || 720; p.h = p.h || 1040;
    p.season = p.season || 1; p.episode = p.episode || 1; p.status = p.status || 'In progress';
    for (const f of p.frames) for (const s of f) s.l = s.l || 1;
  }
  return list;
}
function loadAssets() {
  try { return JSON.parse(localStorage.getItem(AKEY)) || {}; } catch (e) { return {}; }
}
function persist() {
  const used = new Set();
  for (const p of projects) for (const f of p.frames) for (const s of f) if (s.img) used.add(s.img);
  for (const id of Object.keys(assets)) if (!used.has(id)) delete assets[id];   // drop unused images
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
    localStorage.setItem(AKEY, JSON.stringify(assets));
  } catch (e) { alert('Could not save: browser storage is full or blocked.'); }
}
function save() { if (!proj) return; proj.updated = Date.now(); proj.fps = fps; persist(); }
function queueSave() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------- painting ----------
const imgCache = {};
function getImg(id) {
  let im = imgCache[id];
  if (!im && assets[id]) {
    im = imgCache[id] = new Image();
    im.onload = () => { if (proj) refresh(); else renderHome(); };
    im.src = assets[id];
  }
  return im && im.complete && im.naturalWidth ? im : null;
}

function drawItem(ctx, s, tint) {
  if (s.img) {                                         // image: move / rotate / scale transform
    const im = getImg(s.img);
    if (!im) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.r);
    ctx.drawImage(im, -s.w / 2, -s.h / 2, s.w, s.h);
    ctx.restore();
    return;
  }
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = tint || s.color || '#000'; ctx.lineWidth = s.size;
  ctx.beginPath();
  s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
  ctx.stroke();
}

const tmp = document.createElement('canvas');
function paint(ctx, items, layers, noFill, w = W, h = H, tint) {
  for (const L of layers) {
    if (!L.vis) continue;
    const mine = items.filter(s => s.l === L.id);
    const erases = mine.some(s => s.erase);
    let t = ctx;
    if (erases) { tmp.width = w; tmp.height = h; t = tmp.getContext('2d'); }   // erasers only cut their own layer
    if (L.fill && !noFill) { t.fillStyle = L.fill; t.fillRect(0, 0, w, h); }
    for (const s of mine) drawItem(t, s, tint);
    if (erases) ctx.drawImage(tmp, 0, 0);
  }
}

function thumb(items, layers, tw, pw = W, ph = H) {
  const c = document.createElement('canvas');
  c.width = tw; c.height = Math.round(tw * ph / pw);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.scale(tw / pw, tw / pw); paint(x, items, layers, false, pw, ph);
  return c;
}

// ---------- gallery: projects grouped by season, with episode tracker ----------
function show(view) {
  $$('.view').forEach(s => s.classList.toggle('active', s.id === view));
  document.body.classList.toggle('editing', view === 'editor');
}

function renderHome() {
  const grid = $('grid');
  grid.innerHTML = '';
  const add = el('button', 'card new');
  add.innerHTML = '<span>+</span>New project';
  add.onclick = newProject;
  grid.append(add);

  let n = 0;
  for (const s of [...new Set(projects.map(p => p.season))].sort((a, b) => a - b)) {
    const list = projects.filter(p => p.season === s).sort((a, b) => a.episode - b.episode);
    const done = list.filter(p => p.status === 'Done').length;
    const head = el('div', 'season');
    head.innerHTML = '<div><b></b> <small></small></div><div class="bar"><i></i></div>';
    head.querySelector('b').textContent = 'Season ' + s;
    head.querySelector('small').textContent = `${done} of ${list.length} episodes done`;
    head.querySelector('i').style.width = (100 * done / list.length) + '%';
    grid.append(head);

    for (const p of list) {
      const card = el('div', 'card');
      card.style.setProperty('--i', ++n);
      const meta = el('div', 'meta');
      meta.innerHTML = '<b></b><small></small><span class="chip"></span>';
      const [title, info, chip] = meta.children;
      title.textContent = p.name;
      info.textContent = `Episode ${p.episode} · ${p.frames.length} frame${p.frames.length === 1 ? '' : 's'}`;
      chip.textContent = p.status; chip.dataset.s = p.status;
      const del = el('button', 'x');
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete project');
      del.onclick = e => {
        e.stopPropagation();
        if (!confirm(`Delete "${p.name}"?`)) return;
        projects = projects.filter(q => q !== p);
        persist(); renderHome();
      };
      card.append(thumb(p.frames[0], p.layers, 180, p.w, p.h), meta, del);
      card.onclick = () => openProject(p);
      grid.append(card);
    }
  }
}

function newProject() {
  const season = Math.max(1, ...projects.map(p => p.season));
  const episode = Math.max(0, ...projects.filter(p => p.season === season).map(p => p.episode)) + 1;
  const p = {
    id: Date.now(), name: 'Untitled ' + (projects.length + 1), updated: Date.now(), fps: 12,
    w: 585, h: 1040, season, episode, status: 'Planned',
    layers: [{ id: 1, name: 'Layer 1', vis: true }], frames: [[]],
  };
  projects.push(p); persist(); openProject(p);
}

function openProject(p) {
  proj = p; cur = 0; fps = p.fps || 12; hist = []; sel = null; drag = null; clip = {};
  activeL = p.layers[p.layers.length - 1].id;
  $('fps').value = fps; $('name').value = p.name; ref.hidden = true;
  $('season').value = p.season; $('episode').value = p.episode; $('status').value = p.status;
  $('exportOut').textContent = '';
  applySize();
  show('editor');
  renderLayers(); refresh();
}

$('back').onclick = () => {
  if (playing) setPlay(false);
  save(); proj = null; sel = null;
  renderHome(); show('home');
};

// ---------- editor rendering ----------
function paintFrame() {
  dctx.clearRect(0, 0, W, H); octx.clearRect(0, 0, W, H);
  paint(dctx, proj.frames[cur], proj.layers);
  if (onionOn && !playing) {                           // onion skin: previous frame red, next frame grey
    if (cur > 0) paint(octx, proj.frames[cur - 1], proj.layers, true, W, H, '#ff6b6b');
    if (cur < proj.frames.length - 1) paint(octx, proj.frames[cur + 1], proj.layers, true, W, H, '#8a8a8a');
  }
  fxDirty = true;
}

function renderStrip() {
  const strip = $('strip');
  strip.innerHTML = '';
  proj.frames.forEach((f, i) => {
    const b = el('button', 'fr');
    const n = el('small');
    n.textContent = i + 1;
    b.append(thumb(f, proj.layers, 54), n);
    b.onclick = () => { if (!playing) { cur = i; render(); } };
    strip.append(b);
  });
}

function render() {
  if (sel && !proj.frames[cur].includes(sel)) sel = null;
  if (bend && bend.sel.length && !proj.frames[cur].includes(bend.sel[0][0])) bendReset();
  paintFrame();
  const label = $('label');
  label.textContent = `${cur + 1} / ${proj.frames.length}`;
  label.classList.remove('bump'); void label.offsetWidth; label.classList.add('bump');
  const kids = $('strip').children;
  [...kids].forEach((b, i) => b.classList.toggle('on', i === cur));
  if (kids[cur]) kids[cur].scrollIntoView({ inline: 'center', block: 'nearest' });
  drawUI();
}
function refresh() { renderStrip(); render(); }

// ---------- layers ----------
function renderLayers() {
  const box = $('layerList');
  box.innerHTML = '';
  [...proj.layers].reverse().forEach(L => {            // top layer first
    const row = el('div', 'layer' + (L.id === activeL ? ' on' : ''));
    const eye = el('button', 'eye' + (L.vis ? ' on' : ''));
    eye.textContent = L.vis ? '●' : '○';
    eye.setAttribute('aria-label', 'Toggle visibility');
    eye.onclick = () => { L.vis = !L.vis; renderLayers(); refresh(); queueSave(); };
    const nm = el('button', 'nm');
    nm.textContent = L.name;
    if (L.fill) nm.style.borderLeft = `8px solid ${L.fill}`;
    nm.onclick = () => { activeL = L.id; renderLayers(); };
    row.append(eye, nm);
    box.append(row);
  });
}
const nextId = () => Math.max(0, ...proj.layers.map(l => l.id)) + 1;

$('addL').onclick = () => {
  const id = nextId();
  proj.layers.push({ id, name: 'Layer ' + id, vis: true });
  activeL = id; renderLayers(); queueSave();
};
$('addF').onclick = () => {                            // solid-color layer, inserted at the bottom
  const id = nextId();
  proj.layers.unshift({ id, name: 'Fill ' + id, vis: true, fill: $('color').value });
  activeL = id; renderLayers(); refresh(); queueSave();
};
function moveLayer(d) {
  const a = proj.layers, i = a.findIndex(l => l.id === activeL), j = i + d;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  renderLayers(); refresh(); queueSave();
}
$('lUp').onclick = () => moveLayer(1);
$('lDn').onclick = () => moveLayer(-1);
$('lDel').onclick = () => {
  if (proj.layers.length === 1) return;
  const id = activeL;
  proj.layers = proj.layers.filter(l => l.id !== id);
  for (const f of proj.frames) for (let i = f.length - 1; i >= 0; i--) if (f[i].l === id) f.splice(i, 1);
  activeL = proj.layers[proj.layers.length - 1].id;
  renderLayers(); refresh(); queueSave();
};

// ---------- drawing, eraser, color swap, image gizmo ----------
function pos(e) {
  const r = rect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
const pxScale = () => W / rect().width;               // canvas px per screen px

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function pickColor(p) {                                // what color is visible at this point?
  const fr = proj.frames[cur];
  for (let i = proj.layers.length - 1; i >= 0; i--) {
    const L = proj.layers[i];
    if (!L.vis) continue;
    for (let j = fr.length - 1; j >= 0; j--) {
      const s = fr[j];
      if (s.l !== L.id || s.img || s.erase) continue;
      for (let k = 0; k < s.pts.length; k++) {
        if (segDist(p, s.pts[k], s.pts[k + 1] || s.pts[k]) <= s.size / 2 + 10) return s.color;
      }
    }
    if (L.fill) return L.fill;
  }
  return null;
}
function swapColor(p) {                                // every use of the clicked color becomes the selected color
  const from = pickColor(p), to = $('color').value;
  if (!from || from === to) return;
  const changed = [];
  for (const f of proj.frames) for (const s of f) if (s.color === from) { changed.push([s, 'color']); s.color = to; }
  for (const L of proj.layers) if (L.fill === from) { changed.push([L, 'fill']); L.fill = to; }
  hist.push(() => changed.forEach(([o, k]) => { o[k] = from; }));
  renderLayers(); refresh(); queueSave();
}

// image gizmo: drag = move, pink dot = rotate, white corners = scale
function handlePts() {
  const k = pxScale(), c = Math.cos(sel.r), s = Math.sin(sel.r), hw = sel.w / 2, hh = sel.h / 2;
  const to = (lx, ly) => [sel.x + lx * c - ly * s, sel.y + lx * s + ly * c];
  return [['rot', ...to(0, -hh - 36 * k)], ['sc', ...to(hw, hh)], ['sc', ...to(-hw, hh)], ['sc', ...to(hw, -hh)], ['sc', ...to(-hw, -hh)]];
}
function hitImage(p) {
  const f = proj.frames[cur];
  for (let i = proj.layers.length - 1; i >= 0; i--) {
    const L = proj.layers[i];
    if (!L.vis) continue;
    for (let j = f.length - 1; j >= 0; j--) {
      const s = f[j];
      if (s.l !== L.id || !s.img) continue;
      const dx = p[0] - s.x, dy = p[1] - s.y, c = Math.cos(-s.r), n = Math.sin(-s.r);
      if (Math.abs(dx * c - dy * n) <= s.w / 2 && Math.abs(dx * n + dy * c) <= s.h / 2) return s;
    }
  }
  return null;
}
// ---------- viewport (zoom / pan), live painting, bend tool ----------
const vp = $('viewport'), stageEl = $('stage'), pts = new Map();
let view = { z: 1, x: 0, y: 0 }, rectC = null, pinch = null, panning = null, live = null, raf = 0, bend = null;
const rect = () => rectC || (rectC = draw.getBoundingClientRect());
const schedule = fn => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fn(); }); };   // one repaint per frame
const tip = t => { $('tip').textContent = t || ''; };

function applyView() {
  stageEl.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  $('zoomPct').textContent = Math.round(view.z * 100) + '%';
  rectC = null; drawUI();
}
function zoomAt(cx, cy, f) {
  const r = vp.getBoundingClientRect(), vx = cx - r.left - r.width / 2, vy = cy - r.top - r.height / 2;
  const nz = Math.max(0.25, Math.min(8, view.z * f)), k = nz / view.z;
  view.x = vx - (vx - view.x) * k; view.y = vy - (vy - view.y) * k; view.z = nz;
  applyView();
}
const zoomMid = f => { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); };
$('zIn').onclick = () => zoomMid(1.25);
$('zOut').onclick = () => zoomMid(0.8);
$('zFit').onclick = () => { view = { z: 1, x: 0, y: 0 }; applyView(); };
vp.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());   // stop the browser zooming the whole page

vp.addEventListener('pointerdown', e => {              // two fingers = pinch zoom + pan
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 2) {
    abortStroke();
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, v: { ...view }, r: vp.getBoundingClientRect() };
  }
});
vp.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (!pinch || pts.size !== 2) return;
  const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nz = Math.max(0.25, Math.min(8, pinch.v.z * d / pinch.d)), k = nz / pinch.v.z;
  const vx = pinch.mx - pinch.r.left - pinch.r.width / 2, vy = pinch.my - pinch.r.top - pinch.r.height / 2;
  view.z = nz; view.x = vx - (vx - pinch.v.x) * k + mx - pinch.mx; view.y = vy - (vy - pinch.v.y) * k + my - pinch.my;
  applyView();
});
const upPtr = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
vp.addEventListener('pointerup', upPtr); vp.addEventListener('pointercancel', upPtr);

function abortStroke() {
  if (stroke) {
    const f = proj.frames[cur], i = f.indexOf(stroke);
    if (i > -1) f.splice(i, 1);
    hist.pop(); stroke = null; live = null; paintFrame();
  }
  drag = null; panning = null;
}

// live painting: layers above/below the stroke are cached, only the active layer repaints
function snap(layers) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  paint(c.getContext('2d'), proj.frames[cur], layers);
  return c;
}
function paintLive() {
  dctx.clearRect(0, 0, W, H);
  dctx.drawImage(live.below, 0, 0);
  paint(dctx, proj.frames[cur], [live.L]);
  dctx.drawImage(live.above, 0, 0);
  fxDirty = true;
}

// bend tool: circle an area, set a pivot, drag to the goal
function inPoly(q, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function bendReset(msg) {
  bend = { phase: 'lasso', poly: [], sel: [], orig: [] };
  tip(msg || 'Bend: draw a circle around the part to bend');
  drawUI();
}
function bendClose() {
  if (bend.poly.length < 8) { bendReset(); return; }
  bend.sel = []; bend.orig = [];
  let n = 0;
  for (const s of proj.frames[cur]) {
    if (s.l !== activeL || !s.pts) continue;
    const idx = [];
    s.pts.forEach((q, k) => { if (inPoly(q, bend.poly)) idx.push(k); });
    if (idx.length) { bend.sel.push([s, idx]); bend.orig.push(idx.map(k => s.pts[k].slice())); n += idx.length; }
  }
  if (!n) { bendReset('Nothing inside the circle on the active layer. Try again'); return; }
  bend.phase = 'pivot'; tip('Tap the pivot point (the hinge)'); drawUI();
}
function bendDown(p) {
  if (!bend) bendReset();
  if (bend.phase === 'lasso') { bend.poly = [p]; return; }
  if (bend.phase === 'pivot') {
    bend.pivot = p; bend.R = 0;
    for (const [s, idx] of bend.sel) for (const k of idx) {
      const d = Math.hypot(s.pts[k][0] - p[0], s.pts[k][1] - p[1]);
      if (d > bend.R) { bend.R = d; bend.a0 = Math.atan2(s.pts[k][1] - p[1], s.pts[k][0] - p[0]); }
    }
    if (bend.R < 4) { tip('Put the pivot away from the selected part'); return; }
    bend.phase = 'goal'; tip('Drag to the goal point, then let go'); drawUI();
    return;
  }
  bend.goal = p; applyBend(p);
}
function applyBend(g) {                                // rotate around the pivot, more the farther from it
  const P = bend.pivot;
  let t = Math.atan2(g[1] - P[1], g[0] - P[0]) - bend.a0;
  t = Math.atan2(Math.sin(t), Math.cos(t));
  bend.sel.forEach(([s, idx], i) => idx.forEach((k, j) => {
    const o = bend.orig[i][j], dx = o[0] - P[0], dy = o[1] - P[1];
    const w = Math.min(1, Math.hypot(dx, dy) / bend.R), a = t * w * w * (3 - 2 * w), c = Math.cos(a), n = Math.sin(a);
    s.pts[k] = [P[0] + dx * c - dy * n, P[1] + dx * n + dy * c];
  }));
  paintFrame(); drawUI();
}
function bendCommit() {
  const { sel: S, orig } = bend;
  hist.push(() => S.forEach(([st, idx], i) => idx.forEach((k, j) => { st.pts[k] = orig[i][j]; })));
  renderStrip(); queueSave(); bendReset(); paintFrame();
}

function drawUI() {
  uctx.clearRect(0, 0, W, H);
  if (!proj) return;
  const k = pxScale();
  uctx.lineWidth = 2 * k; uctx.strokeStyle = '#ff6b6b';
  const dot = (p, col) => { uctx.beginPath(); uctx.arc(p[0], p[1], 8 * k, 0, 7); uctx.fillStyle = col; uctx.fill(); uctx.stroke(); };
  if (tool === 'bend' && bend) {
    if (bend.poly.length > 1) {
      uctx.setLineDash([8 * k, 6 * k]); uctx.beginPath();
      bend.poly.forEach(([x, y], i) => (i ? uctx.lineTo(x, y) : uctx.moveTo(x, y)));
      uctx.closePath(); uctx.stroke(); uctx.setLineDash([]);
    }
    if (bend.pivot) dot(bend.pivot, '#ff6b6b');
    if (bend.goal) {
      uctx.beginPath(); uctx.moveTo(bend.pivot[0], bend.pivot[1]); uctx.lineTo(bend.goal[0], bend.goal[1]); uctx.stroke();
      dot(bend.goal, '#fff');
    }
  }
  if (sel && tool === 'move') {
    uctx.save(); uctx.translate(sel.x, sel.y); uctx.rotate(sel.r);
    uctx.strokeRect(-sel.w / 2, -sel.h / 2, sel.w, sel.h);
    uctx.beginPath(); uctx.moveTo(0, -sel.h / 2); uctx.lineTo(0, -sel.h / 2 - 36 * k); uctx.stroke();
    uctx.restore();
    for (const [kind, x, y] of handlePts()) dot([x, y], kind === 'rot' ? '#ff6b6b' : '#fff');
  }
}
window.addEventListener('resize', () => { rectC = null; drawUI(); });   // also fires when the phone is rotated

draw.addEventListener('pointerdown', e => {
  if (!e.isPrimary || playing || pinch) return;
  rectC = null;
  const p = pos(e);
  if (tool === 'hand' || e.button === 1) {
    panning = { x: e.clientX, y: e.clientY, v: { ...view } };
    draw.setPointerCapture(e.pointerId);
    return;
  }
  if (tool === 'swap') { swapColor(p); return; }
  draw.setPointerCapture(e.pointerId);
  if (tool === 'bend') { bendDown(p); return; }
  if (tool === 'move') {
    const h = sel && handlePts().find(([, x, y]) => Math.hypot(p[0] - x, p[1] - y) < 18 * pxScale());
    if (!h) sel = hitImage(p);
    if (sel) drag = { mode: h ? h[0] : 'move', p0: p, o: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, r: sel.r } };
    drawUI();
    return;
  }
  const L = proj.layers.find(l => l.id === activeL);
  if (!L.vis) { L.vis = true; renderLayers(); }
  const f = proj.frames[cur], i = proj.layers.indexOf(L);
  live = { L, below: snap(proj.layers.slice(0, i)), above: snap(proj.layers.slice(i + 1)) };
  stroke = { l: activeL, size: +$('size').value, pts: [p] };
  if (tool === 'erase') stroke.erase = true; else stroke.color = $('color').value;
  f.push(stroke);
  const s = stroke;
  hist.push(() => { const n = f.indexOf(s); if (n > -1) f.splice(n, 1); });
  schedule(() => live && paintLive());
});
draw.addEventListener('pointermove', e => {
  if (!e.isPrimary || pinch) return;
  if (panning) {
    view.x = panning.v.x + e.clientX - panning.x; view.y = panning.v.y + e.clientY - panning.y;
    applyView(); return;
  }
  const p = pos(e);
  if (drag) {
    const o = drag.o;
    if (drag.mode === 'move') { sel.x = o.x + p[0] - drag.p0[0]; sel.y = o.y + p[1] - drag.p0[1]; }
    else if (drag.mode === 'rot') sel.r = Math.atan2(p[1] - o.y, p[0] - o.x) + Math.PI / 2;
    else {
      const f = Math.hypot(p[0] - o.x, p[1] - o.y) / Math.max(1, Math.hypot(drag.p0[0] - o.x, drag.p0[1] - o.y));
      sel.w = o.w * f; sel.h = o.h * f;
    }
    schedule(() => { paintFrame(); drawUI(); });
  } else if (stroke) {
    const q = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5) return;        // skip near-duplicate points: less data, less lag
    stroke.pts.push(p);
    schedule(() => live && paintLive());
  } else if (bend && tool === 'bend') {
    if (bend.phase === 'lasso' && bend.poly.length) { bend.poly.push(p); schedule(drawUI); }
    else if (bend.phase === 'goal' && bend.goal) { bend.goal = p; schedule(() => applyBend(bend.goal)); }
  }
});
const endPointer = e => {
  if (!e.isPrimary) return;
  if (panning) { panning = null; return; }
  if (drag) {
    const it = sel, o = drag.o;
    drag = null;
    if (Object.keys(o).some(k => it[k] !== o[k])) { hist.push(() => Object.assign(it, o)); renderStrip(); queueSave(); }
  } else if (stroke) {
    stroke = null; live = null; renderStrip(); render(); queueSave();
  } else if (bend && tool === 'bend') {
    if (bend.phase === 'lasso') bendClose();
    else if (bend.phase === 'goal' && bend.goal) bendCommit();
  }
};
draw.addEventListener('pointerup', endPointer);
draw.addEventListener('pointercancel', endPointer);

$('undo').onclick = () => {
  if (playing) return;
  const u = hist.pop();
  if (u) { u(); renderLayers(); refresh(); queueSave(); }
};

// ---------- frames ----------
function step(d) {
  if (playing) return;
  cur = (cur + d + proj.frames.length) % proj.frames.length;
  render();
}
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('add').onclick = () => { if (!playing) { proj.frames.splice(cur + 1, 0, []); cur++; refresh(); queueSave(); } };
$('dup').onclick = () => {
  if (playing) return;
  proj.frames.splice(cur + 1, 0, JSON.parse(JSON.stringify(proj.frames[cur]))); cur++;
  refresh(); queueSave();
};
$('del').onclick = () => {
  if (playing || proj.frames.length === 1) return;
  proj.frames.splice(cur, 1);
  cur = Math.min(cur, proj.frames.length - 1);
  refresh(); queueSave();
};
$('clear').onclick = () => {
  if (playing) return;
  const f = proj.frames[cur], old = f.splice(0);
  hist.push(() => f.push(...old));
  refresh(); queueSave();
};
$('onionBtn').onclick = e => { onionOn = !onionOn; e.currentTarget.classList.toggle('on', onionOn); paintFrame(); };

function setPlay(on) {
  playing = on;
  $('play').textContent = on ? 'Stop' : 'Play';
  $('play').classList.toggle('playing', on);
  clearInterval(timer);
  if (on) timer = setInterval(() => { cur = (cur + 1) % proj.frames.length; render(); }, 1000 / fps);
  render();
}
$('play').onclick = () => setPlay(!playing);
$('fps').oninput = e => {
  fps = Math.max(1, Math.min(60, +e.target.value || 12));
  if (playing) setPlay(true);
  queueSave();
};
$('name').oninput = e => { proj.name = e.target.value.trim() || 'Untitled'; queueSave(); };

// ---------- menu tabs ----------
$$('#tabs button').forEach(b => {
  b.onclick = () => {
    $$('#tabs button').forEach(t => t.classList.toggle('on', t === b));
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.p));
  };
});

// ---------- tools panel ----------
const HINTS = {
  brush: '', hand: 'Drag to pan. Pinch or scroll to zoom.',
  erase: 'The eraser only cuts the active layer.',
  swap: 'Tap any color in your drawing. Every use of it, in all frames, becomes the selected color.',
  move: 'Tap an image to select it. Drag to move, the red dot rotates, the white corners scale.',
};
const TOOLS = { tBrush: 'brush', tErase: 'erase', tSwap: 'swap', tMove: 'move', tBend: 'bend', tHand: 'hand' };
function setTool(t) {
  tool = t;
  for (const [id, name] of Object.entries(TOOLS)) $(id).classList.toggle('on', name === t);
  draw.style.cursor = { brush: 'crosshair', erase: 'cell', swap: 'copy', move: 'default', bend: 'crosshair', hand: 'grab' }[t];
  if (t === 'bend') bendReset(); else { bend = null; tip(HINTS[t]); }
  drawUI();
}
for (const [id, name] of Object.entries(TOOLS)) $(id).onclick = () => setTool(name);

for (const c of PALETTE) {
  const b = el('button');
  b.style.background = c;
  b.setAttribute('aria-label', 'Color ' + c);
  b.onclick = () => { $('color').value = c; };
  $('swatches').append(b);
}

$('refFile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  ref.src = URL.createObjectURL(f);
  ref.style.opacity = $('refAlpha').value;
  ref.hidden = false;
};
$('refAlpha').oninput = e => { ref.style.opacity = e.target.value; };

// images: stored shrunk (max 1024px) so they fit in browser storage
$('imgFile').onchange = e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !proj) return;
  const src = new Image();
  src.onload = () => {
    const m = Math.min(1, 1024 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * m); c.height = Math.round(src.height * m);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src.src);
    const id = 'a' + Date.now();
    assets[id] = c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
    const s = 0.6 * Math.min(W / c.width, H / c.height);
    const item = { l: activeL, img: id, x: W / 2, y: H / 2, w: c.width * s, h: c.height * s, r: 0 };
    const fr = proj.frames[cur];
    fr.push(item);
    hist.push(() => { const i = fr.indexOf(item); if (i > -1) fr.splice(i, 1); });
    proj.layers.find(l => l.id === activeL).vis = true;
    sel = item; setTool('move'); renderLayers(); refresh(); queueSave();
  };
  src.src = URL.createObjectURL(f);
};
$('imgDel').onclick = () => {
  if (!sel || playing) return;
  const f = proj.frames[cur], i = f.indexOf(sel), it = sel;
  if (i < 0) return;
  f.splice(i, 1); sel = null;
  hist.push(() => f.splice(i, 0, it));
  refresh(); queueSave();
};

// bring the previous frame's drawing into this frame
$('fromLast').onclick = () => {
  if (playing || cur === 0) return;
  const f = proj.frames[cur], add = JSON.parse(JSON.stringify(proj.frames[cur - 1]));
  f.push(...add);
  hist.push(() => add.forEach(it => { const i = f.indexOf(it); if (i > -1) f.splice(i, 1); }));
  refresh(); queueSave();
};

// ---------- copy / paste, toasts, shortcuts ----------
const clone = o => JSON.parse(JSON.stringify(o));
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1500);
}
function addItems(items) {                             // add items to the current frame (undoable)
  const f = proj.frames[cur];
  f.push(...items);
  hist.push(() => items.forEach(it => { const i = f.indexOf(it); if (i > -1) f.splice(i, 1); }));
}
function copy() {
  if (!proj) return;
  if (sel) { clip = { item: clone(sel) }; toast('Copied image'); }
  else { clip = { frame: clone(proj.frames[cur]) }; toast(`Copied frame ${cur + 1}`); }
}
function paste() {
  if (!proj || playing) return;
  if (clip.item) {
    const it = { ...clone(clip.item), l: activeL }; it.x += 30; it.y += 30;
    addItems([it]); sel = it; setTool('move'); refresh(); queueSave(); toast('Pasted image');
  } else if (clip.frame) {
    proj.frames.splice(cur + 1, 0, clone(clip.frame)); cur++;
    refresh(); queueSave(); toast('Pasted as a new frame');
  } else toast('Nothing copied yet');
}
$('fCopy').onclick = copy;
$('fPaste').onclick = paste;
$('fMerge').onclick = () => {                          // lay the copied frame's art on top of this frame
  if (playing) return;
  if (!clip.frame) { toast('Copy a frame first'); return; }
  addItems(clone(clip.frame)); refresh(); queueSave(); toast('Merged into this frame');
};

$('lDup').onclick = () => {                            // duplicates the layer, with its art in every frame
  const a = proj.layers, i = a.findIndex(l => l.id === activeL), id = nextId();
  a.splice(i + 1, 0, { ...a[i], id, name: a[i].name + ' copy' });
  for (const f of proj.frames) f.push(...f.filter(s => s.l === activeL).map(s => ({ ...clone(s), l: id })));
  activeL = id; renderLayers(); refresh(); queueSave(); toast('Layer duplicated');
};
$('lCopy').onclick = () => { clip = { art: clone(proj.frames[cur].filter(s => s.l === activeL)) }; toast('Copied layer art'); };
$('lPaste').onclick = () => {                          // pastes the copied art onto the active layer of this frame
  if (playing) return;
  if (!clip.art) { toast('Copy layer art first'); return; }
  addItems(clone(clip.art).map(s => ({ ...s, l: activeL })));
  proj.layers.find(l => l.id === activeL).vis = true;
  renderLayers(); refresh(); queueSave(); toast('Pasted layer art');
};

document.addEventListener('keydown', e => {
  if (!proj || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'c') { e.preventDefault(); copy(); }
  else if (mod && k === 'v') { e.preventDefault(); paste(); }
  else if (mod && k === 'z') { e.preventDefault(); $('undo').click(); }
  else if (k === 'arrowright') step(1);
  else if (k === 'arrowleft') step(-1);
  else if (k === ' ') { e.preventDefault(); setPlay(!playing); }
  else if (k === 'delete' || k === 'backspace') $('imgDel').click();
  else if (k === 'b') setTool('brush');
  else if (k === 'e') setTool('erase');
});

// ---------- project panel: ratio, season / episode, video export ----------
function applySize() {
  W = proj.w; H = proj.h;
  for (const c of [draw, onion, fxc, uic]) { c.width = W; c.height = H; }
  $('stage').style.setProperty('--ar', W / H);
  view = { z: 1, x: 0, y: 0 }; applyView();
  fxDirty = true;
}
function remap(a, b) {                                 // fit existing artwork into the new canvas size
  const s = Math.min(b[0] / a[0], b[1] / a[1]), ox = (b[0] - a[0] * s) / 2, oy = (b[1] - a[1] * s) / 2;
  for (const f of proj.frames) for (const it of f) {
    if (it.pts) { it.pts = it.pts.map(([x, y]) => [x * s + ox, y * s + oy]); it.size *= s; }
    else { it.x = it.x * s + ox; it.y = it.y * s + oy; it.w *= s; it.h *= s; }
  }
}
function setRatio(rw, rh) {
  const r = Math.max(0.25, Math.min(4, rw / rh));
  if (!(r > 0)) return;
  const nw = r >= 1 ? 1040 : Math.round(1040 * r), nh = r >= 1 ? Math.round(1040 / r) : 1040;
  remap([proj.w, proj.h], [nw, nh]);
  proj.w = nw; proj.h = nh; sel = null;
  applySize(); refresh(); queueSave();
}
for (const [rw, rh] of [[9, 16], [16, 9], [1, 1], [4, 3], [3, 4]]) {
  const b = el('button');
  b.textContent = `${rw}:${rh}`;
  b.onclick = () => { $('rw').value = rw; $('rh').value = rh; setRatio(rw, rh); };
  $('ratios').append(b);
}
$('setRatio').onclick = () => setRatio(+$('rw').value, +$('rh').value);

$('season').oninput = e => { proj.season = Math.max(1, +e.target.value || 1); queueSave(); };
$('episode').oninput = e => { proj.episode = Math.max(1, +e.target.value || 1); queueSave(); };
$('status').onchange = e => { proj.status = e.target.value; queueSave(); };

const wait = ms => new Promise(r => setTimeout(r, ms));
const nextPaint = () => new Promise(r => requestAnimationFrame(r));

$('export').onclick = async () => {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { alert('This browser cannot record video.'); return; }
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { alert('No supported video format in this browser.'); return; }
  if (playing) setPlay(false);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const x = out.getContext('2d');
  const rec = new MediaRecorder(out.captureStream(fps), { mimeType: type, videoBitsPerSecond: 6e6 });
  const chunks = [], keep = cur, msg = $('exportOut');
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  playing = true; sel = null;                          // playing = true locks editing while recording
  $('export').disabled = $('play').disabled = true;
  try {
    rec.start();
    for (let i = 0; i < proj.frames.length; i++) {
      cur = i; msg.textContent = `Recording ${i + 1} / ${proj.frames.length}`;
      paintFrame(); await nextPaint(); await nextPaint();
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.drawImage(fxMode ? fxc : draw, 0, 0);          // includes the active shader
      await wait(1000 / fps);
    }
    rec.stop(); await stopped;
    const blob = new Blob(chunks, { type });
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const mov = ios && type.includes('mp4');                       // iPhone / iPad: name it .mov
    const ext = mov ? 'mov' : type.includes('mp4') ? 'mp4' : 'webm';
    const mime = type.split(';')[0];
    const file = new File([blob], `${proj.name}.${ext}`, { type: mov ? 'video/quicktime' : mime });
    const cands = mov ? [file, new File([blob], `${proj.name}.mp4`, { type: mime })] : [file];

    msg.textContent = '';
    const save = el('button', 'primary');
    save.textContent = 'Save to Photos';
    save.onclick = async () => {                                   // sharing must start from a tap, so it can't run on its own
      const f = navigator.canShare && cands.find(c => navigator.canShare({ files: [c] }));
      if (!f) { toast('Sharing files is not supported here. Use Download.'); return; }
      try { await navigator.share({ files: [f], title: proj.name }); }
      catch (e) { if (e.name !== 'AbortError') toast('Could not open the share sheet'); }
    };
    const dl = el('a', 'btn');
    dl.textContent = 'Download'; dl.href = URL.createObjectURL(file); dl.download = file.name;
    const hint = el('small');
    hint.style.flexBasis = '100%';
    hint.textContent = ios ? 'Tap Save to Photos, then choose Save Video.' : 'Tap Save to Photos, then choose Photos or Gallery.';
    msg.append(save, dl, hint);
  } finally {
    playing = false; cur = keep;
    $('export').disabled = $('play').disabled = false;
    render();
  }
};

// ---------- shaders (WebGL post-processing of the drawing) ----------
const gl = fxc.getContext('webgl', { preserveDrawingBuffer: true });
let fxMode = 0, fxDirty = true, fxRun = false, U = {};

if (gl) {
  const vs = 'attribute vec2 a;varying vec2 uv;void main(){uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  const fs = `precision mediump float;
varying vec2 uv; uniform sampler2D t; uniform float time, k; uniform int mode; uniform vec2 res;
vec3 px(vec2 p){ vec4 c = texture2D(t, p); return mix(vec3(1.), c.rgb, c.a); }
void main(){
  vec2 p = uv;
  if (mode == 4) { vec2 g = res / (4. + k * 28.); p = (floor(p * g) + .5) / g; }
  if (mode == 5) p.x += sin(p.y * 40. + time * 4.) * .01 * k;
  vec3 c = px(p);
  float v = dot(uv - .5, uv - .5) * 2.;
  if (mode == 1) {
    vec3 b = vec3(0.);
    for (int i = 0; i < 8; i++) { float a = float(i) * .785; b += px(p + vec2(cos(a), sin(a)) * .015); }
    c = mix(c, b / 8., k * .8);
  }
  if (mode == 2) { c *= 1. - k * .35 * (.5 + .5 * sin(uv.y * 1600.)); c *= 1. - k * .7 * v; }
  if (mode == 3) {
    float g = dot(c, vec3(.3, .59, .11));
    c = mix(c, vec3(smoothstep(.1, .85, g)), k) * (1. - k * .6 * v);
    c += (fract(sin(dot(uv * (time + 1.), vec2(12.9898, 78.233))) * 43758.5453) - .5) * .08 * k;
  }
  if (mode == 6) { float o = .012 * k; c = vec3(px(p + vec2(o, 0.)).r, px(p).g, px(p - vec2(o, 0.)).b); }
  gl_FragColor = vec4(c, 1.);
}`;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  for (const n of ['time', 'k', 'mode', 'res']) U[n] = gl.getUniformLocation(prog, n);
}

function fxLoop(now) {
  if (!fxMode) { fxRun = false; return; }
  if (fxDirty) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw); fxDirty = false; }
  gl.viewport(0, 0, W, H);
  gl.uniform1f(U.time, now / 1000);
  gl.uniform1f(U.k, +$('fxK').value);
  gl.uniform1i(U.mode, fxMode);
  gl.uniform2f(U.res, W, H);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(fxLoop);
}
function setFx(m) {
  if (m && !gl) { alert('Shaders need WebGL, which this browser has turned off.'); return false; }
  fxMode = m; fxDirty = true;
  fxc.style.display = m ? 'block' : 'none';
  draw.style.opacity = m ? 0 : 1;                      // stays on top for touch input, just invisible
  if (m && !fxRun) { fxRun = true; requestAnimationFrame(fxLoop); }
  return true;
}
FX.forEach((name, i) => {
  const b = el('button', i ? '' : 'on');
  b.textContent = name;
  b.onclick = () => { if (setFx(i)) $$('#fxList button').forEach(x => x.classList.toggle('on', x === b)); };
  $('fxList').append(b);
});

setTool('brush');
renderHome();
$('flipOk').onclick = () => $('flip').classList.add('off');
for (let i = 0; i < 22; i++) {                         // animated square background
  const s = document.createElement('i'), size = 20 + Math.random() * 90;
  s.style.cssText = `--s:${size}px;--x:${Math.random() * 100}%;--d:${14 + Math.random() * 22}s;--dl:-${Math.random() * 30}s`;
  $('bg').append(s);
}
