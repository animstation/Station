// Animator workstation: gallery + editor with filmstrip, layers, color swap tool, WebGL shaders.
// Project = { id, name, updated, fps, layers: [{ id, name, vis, fill? }], frames }
// frames[i] = strokes [{ l: layerId, color, size, pts }]  (layers listed bottom to top)

const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);
const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls || ''; return e; };
const W = 720, H = 1040, KEY = 'animator.projects';
const PALETTE = ['#000000', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const FX = ['Off', 'Soft', 'CRT', 'Noir', 'Pixel', 'Wobble', 'Chroma'];

const draw = $('draw'), onion = $('onion'), ref = $('ref'), fxc = $('fx');
const dctx = draw.getContext('2d'), octx = onion.getContext('2d');
for (const c of [draw, onion, fxc]) { c.width = W; c.height = H; }

let projects = loadAll(), proj = null, activeL = 1, hist = [];
let cur = 0, fps = 12, playing = false, timer = null, onionOn = true, stroke = null, saveT = null, tool = 'brush';

// ---------- storage ----------
function loadAll() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { /* ignore */ }
  for (const p of list) {                       // upgrade projects saved before layers existed
    p.layers = p.layers || [{ id: 1, name: 'Layer 1', vis: true }];
    for (const f of p.frames) for (const s of f) s.l = s.l || 1;
  }
  return list;
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(projects)); }
  catch (e) { alert('Could not save: browser storage is full or blocked.'); }
}
function save() { if (!proj) return; proj.updated = Date.now(); proj.fps = fps; persist(); }
function queueSave() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------- painting ----------
function paint(ctx, strokes, layers, noFill) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const L of layers) {
    if (!L.vis) continue;
    if (L.fill && !noFill) { ctx.fillStyle = L.fill; ctx.fillRect(0, 0, W, H); }
    for (const s of strokes) {
      if (s.l !== L.id) continue;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
      ctx.stroke();
    }
  }
}
function thumb(strokes, layers, w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round(w * H / W);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.scale(w / W, w / W); paint(x, strokes, layers);
  return c;
}

// ---------- gallery ----------
function show(view) { $$('.view').forEach(s => s.classList.toggle('active', s.id === view)); }

function renderHome() {
  const grid = $('grid');
  grid.innerHTML = '';
  const add = el('button', 'card new');
  add.innerHTML = '<span>+</span>New project';
  add.onclick = newProject;
  grid.append(add);

  projects.sort((a, b) => b.updated - a.updated).forEach((p, i) => {
    const card = el('div', 'card');
    card.style.setProperty('--i', i + 1);
    const meta = el('div', 'meta');
    meta.innerHTML = '<b></b><small></small>';
    meta.firstChild.textContent = p.name;
    meta.lastChild.textContent = `${p.frames.length} frame${p.frames.length === 1 ? '' : 's'}`;
    const del = el('button', 'x');
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete project');
    del.onclick = e => {
      e.stopPropagation();
      if (!confirm(`Delete "${p.name}"?`)) return;
      projects = projects.filter(q => q !== p);
      persist(); renderHome();
    };
    card.append(thumb(p.frames[0], p.layers, 180), meta, del);
    card.onclick = () => openProject(p);
    grid.append(card);
  });
}

function newProject() {
  const p = {
    id: Date.now(), name: 'Untitled ' + (projects.length + 1), updated: Date.now(), fps: 12,
    layers: [{ id: 1, name: 'Layer 1', vis: true }], frames: [[]],
  };
  projects.push(p); persist(); openProject(p);
}

function openProject(p) {
  proj = p; cur = 0; fps = p.fps || 12; hist = [];
  activeL = p.layers[p.layers.length - 1].id;
  $('fps').value = fps; $('name').value = p.name; ref.hidden = true;
  show('editor');
  renderLayers(); refresh();
}

$('back').onclick = () => {
  if (playing) setPlay(false);
  save(); proj = null;
  renderHome(); show('home');
};

// ---------- editor rendering ----------
function paintFrame() {
  dctx.clearRect(0, 0, W, H); octx.clearRect(0, 0, W, H);
  paint(dctx, proj.frames[cur], proj.layers);
  if (onionOn && !playing && cur > 0) paint(octx, proj.frames[cur - 1], proj.layers, true);
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
  paintFrame();
  const label = $('label');
  label.textContent = `${cur + 1} / ${proj.frames.length}`;
  label.classList.remove('bump'); void label.offsetWidth; label.classList.add('bump');
  const kids = $('strip').children;
  [...kids].forEach((b, i) => b.classList.toggle('on', i === cur));
  if (kids[cur]) kids[cur].scrollIntoView({ inline: 'center', block: 'nearest' });
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

// ---------- drawing + color swap ----------
function pos(e) {
  const r = draw.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
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
      if (s.l !== L.id) continue;
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

draw.addEventListener('pointerdown', e => {
  if (playing) return;
  const p = pos(e);
  if (tool === 'swap') { swapColor(p); return; }
  const L = proj.layers.find(l => l.id === activeL);
  if (!L.vis) { L.vis = true; renderLayers(); }
  draw.setPointerCapture(e.pointerId);
  const f = proj.frames[cur];
  stroke = { l: activeL, color: $('color').value, size: +$('size').value, pts: [p] };
  f.push(stroke);
  const s = stroke;
  hist.push(() => { const i = f.indexOf(s); if (i > -1) f.splice(i, 1); });
  paintFrame();
});
draw.addEventListener('pointermove', e => {
  if (!stroke) return;
  stroke.pts.push(pos(e));
  paintFrame();
});
const endStroke = () => { if (stroke) { stroke = null; renderStrip(); render(); queueSave(); } };
draw.addEventListener('pointerup', endStroke);
draw.addEventListener('pointercancel', endStroke);

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

// ---------- dock tabs ----------
$$('#tabs button').forEach(b => {
  b.onclick = () => {
    const dock = $('dock');
    if (b.classList.contains('on')) { dock.classList.toggle('min'); return; }   // tap the open tab to collapse
    dock.classList.remove('min');
    $$('#tabs button').forEach(t => t.classList.toggle('on', t === b));
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.p));
  };
});

// ---------- tools panel ----------
function setTool(t) {
  tool = t;
  $('tBrush').classList.toggle('on', t === 'brush');
  $('tSwap').classList.toggle('on', t === 'swap');
  draw.style.cursor = t === 'swap' ? 'copy' : 'crosshair';
  $('hint').textContent = t === 'swap'
    ? 'Tap any color in your drawing. Every use of it, in all frames, becomes the selected color.'
    : '';
}
$('tBrush').onclick = () => setTool('brush');
$('tSwap').onclick = () => setTool('swap');

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

// ---------- shaders (WebGL post-processing of the drawing) ----------
const gl = fxc.getContext('webgl');
let fxMode = 0, fxDirty = true, fxRun = false, U = {};

if (gl) {
  const vs = 'attribute vec2 a;varying vec2 uv;void main(){uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  const fs = `precision mediump float;
varying vec2 uv; uniform sampler2D t; uniform float time, k; uniform int mode;
vec3 px(vec2 p){ vec4 c = texture2D(t, p); return mix(vec3(1.), c.rgb, c.a); }
void main(){
  vec2 p = uv;
  if (mode == 4) { vec2 g = vec2(720., 1040.) / (4. + k * 28.); p = (floor(p * g) + .5) / g; }
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
  for (const n of ['time', 'k', 'mode']) U[n] = gl.getUniformLocation(prog, n);
}

function fxLoop(now) {
  if (!fxMode) { fxRun = false; return; }
  if (fxDirty) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw); fxDirty = false; }
  gl.viewport(0, 0, W, H);
  gl.uniform1f(U.time, now / 1000);
  gl.uniform1f(U.k, +$('fxK').value);
  gl.uniform1i(U.mode, fxMode);
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
