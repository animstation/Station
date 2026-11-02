// Animator: project gallery + frame-by-frame editor. Saves to this browser (localStorage).
// A project = { id, name, updated, fps, frames }, frames[i] = strokes [{ color, size, pts }]

const $ = id => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls || ''; return e; };
const W = 720, H = 1040, KEY = 'animator.projects';

const draw = $('draw'), onion = $('onion'), ref = $('ref');
const dctx = draw.getContext('2d'), octx = onion.getContext('2d');
for (const c of [draw, onion]) { c.width = W; c.height = H; }

let projects = loadAll();
let proj = null;          // the open project
let cur = 0, fps = 12, playing = false, timer = null, onionOn = true, stroke = null, saveT = null;

// ---------- storage ----------
function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(projects)); }
  catch (e) { alert('Could not save: browser storage is full or blocked.'); }
}
function save() { if (!proj) return; proj.updated = Date.now(); proj.fps = fps; persist(); }
function queueSave() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------- drawing helpers ----------
function paint(ctx, strokes) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.size;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
    ctx.stroke();
  }
}
function thumb(p) {
  const c = document.createElement('canvas');
  c.width = 180; c.height = 260;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 180, 260);
  x.scale(0.25, 0.25); paint(x, p.frames[0]);
  return c;
}

// ---------- home screen ----------
function show(view) {
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('active', s.id === view);
}

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

    card.append(thumb(p), meta, del);
    card.onclick = () => openProject(p);
    grid.append(card);
  });
}

function newProject() {
  const p = { id: Date.now(), name: 'Untitled ' + (projects.length + 1), updated: Date.now(), fps: 12, frames: [[]] };
  projects.push(p);
  persist();
  openProject(p);
}

function openProject(p) {
  proj = p; cur = 0; fps = p.fps || 12;
  $('fps').value = fps; $('name').value = p.name;
  ref.hidden = true;
  show('editor');
  render();
}

$('back').onclick = () => {
  if (playing) setPlay(false);
  save(); proj = null;
  renderHome(); show('home');
};

// ---------- editor rendering ----------
function paintFrame() {
  dctx.clearRect(0, 0, W, H);
  octx.clearRect(0, 0, W, H);
  paint(dctx, proj.frames[cur]);
  if (onionOn && !playing && cur > 0) paint(octx, proj.frames[cur - 1]);
}

function renderUI() {
  const n = proj.frames.length, dots = $('dots');
  const label = $('label');
  label.textContent = `${cur + 1} / ${n}`;
  label.classList.remove('bump'); void label.offsetWidth; label.classList.add('bump');
  if (dots.children.length !== n) {
    dots.innerHTML = proj.frames.map((_, i) => `<i data-i="${i}"></i>`).join('');
  }
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i === cur));
  dots.children[cur].scrollIntoView({ inline: 'center', block: 'nearest' });
}

function render() { paintFrame(); renderUI(); }

// ---------- drawing input ----------
function pos(e) {
  const r = draw.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
draw.addEventListener('pointerdown', e => {
  if (playing) return;
  draw.setPointerCapture(e.pointerId);
  stroke = { color: $('color').value, size: +$('size').value, pts: [pos(e)] };
  proj.frames[cur].push(stroke);
  paintFrame();
});
draw.addEventListener('pointermove', e => {
  if (!stroke) return;
  stroke.pts.push(pos(e));
  paintFrame();
});
const endStroke = () => { if (stroke) { stroke = null; queueSave(); } };
draw.addEventListener('pointerup', endStroke);
draw.addEventListener('pointercancel', endStroke);

// ---------- frame changer ----------
function step(d) {
  if (playing) return;
  cur = (cur + d + proj.frames.length) % proj.frames.length;
  render();
}
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('dots').onclick = e => {
  const i = e.target.dataset.i;
  if (i !== undefined && !playing) { cur = +i; render(); }
};
$('add').onclick = () => {
  if (playing) return;
  proj.frames.splice(cur + 1, 0, []); cur++;
  render(); queueSave();
};
$('del').onclick = () => {
  if (playing || proj.frames.length === 1) return;
  proj.frames.splice(cur, 1);
  cur = Math.min(cur, proj.frames.length - 1);
  render(); queueSave();
};

// ---------- playback ----------
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

// ---------- tools ----------
$('name').oninput = e => { proj.name = e.target.value.trim() || 'Untitled'; queueSave(); };
$('onionBtn').onclick = e => { onionOn = !onionOn; e.currentTarget.classList.toggle('on', onionOn); paintFrame(); };
$('undo').onclick = () => { if (!playing) { proj.frames[cur].pop(); paintFrame(); queueSave(); } };
$('clear').onclick = () => { if (!playing) { proj.frames[cur] = []; paintFrame(); queueSave(); } };

// reference image (kept for this session only)
$('refFile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  ref.src = URL.createObjectURL(f);
  ref.style.opacity = $('refAlpha').value;
  ref.hidden = false;
};
$('refAlpha').oninput = e => { ref.style.opacity = e.target.value; };

renderHome();
