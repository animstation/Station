// Animator MVP: draw, frame changer, onion skin, playback, reference image.
// Frames are stored as data (strokes made of points), not pixels.
// That makes undo trivial and will make saving and tweening easy later.

const $ = id => document.getElementById(id);
const W = 720, H = 1040;                       // internal canvas size

const draw = $('draw'), onion = $('onion'), ref = $('ref');
const dctx = draw.getContext('2d');
const octx = onion.getContext('2d');
for (const c of [draw, onion]) { c.width = W; c.height = H; }

let frames = [[]];     // frames[i] = array of strokes: { color, size, pts: [[x, y], ...] }
let cur = 0;           // current frame index (0-based, unlike Luau!)
let fps = 12;
let playing = false;
let timer = null;
let onionOn = true;
let stroke = null;     // the stroke being drawn right now

// ---------- rendering ----------
function paint(ctx, strokes) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]); // single dot
    ctx.stroke();
  }
}

function render() {
  dctx.clearRect(0, 0, W, H);
  octx.clearRect(0, 0, W, H);
  paint(dctx, frames[cur]);
  if (onionOn && !playing && cur > 0) paint(octx, frames[cur - 1]);
  $('label').textContent = `Frame ${cur + 1} / ${frames.length}`;
}

// ---------- drawing ----------
function pos(e) {
  const r = draw.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}

draw.addEventListener('pointerdown', e => {
  if (playing) return;
  draw.setPointerCapture(e.pointerId);
  stroke = { color: $('color').value, size: +$('size').value, pts: [pos(e)] };
  frames[cur].push(stroke);
  render();
});

draw.addEventListener('pointermove', e => {
  if (!stroke) return;
  stroke.pts.push(pos(e));
  render();
});

const endStroke = () => { stroke = null; };
draw.addEventListener('pointerup', endStroke);
draw.addEventListener('pointercancel', endStroke);

// ---------- frame changer ----------
function step(delta) {
  if (playing) return;
  cur = (cur + delta + frames.length) % frames.length;
  render();
}

$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);

$('add').onclick = () => {
  if (playing) return;
  frames.splice(cur + 1, 0, []);               // new blank frame after current
  cur++;
  render();
};

$('del').onclick = () => {
  if (playing || frames.length === 1) return;
  frames.splice(cur, 1);
  cur = Math.min(cur, frames.length - 1);
  render();
};

// ---------- playback ----------
function startTimer() {
  clearInterval(timer);
  if (playing) {
    timer = setInterval(() => { cur = (cur + 1) % frames.length; render(); }, 1000 / fps);
  }
}

$('play').onclick = () => {
  playing = !playing;
  $('play').textContent = playing ? 'Stop' : 'Play';
  startTimer();
  render();
};

$('fps').oninput = e => {
  fps = Math.max(1, Math.min(60, +e.target.value || 12));
  startTimer();
};

// ---------- tools ----------
$('onionBtn').onclick = () => { onionOn = !onionOn; render(); };
$('undo').onclick = () => { if (!playing) { frames[cur].pop(); render(); } };
$('clear').onclick = () => { if (!playing) { frames[cur] = []; render(); } };

// ---------- reference image ----------
$('refFile').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  ref.src = URL.createObjectURL(file);
  ref.hidden = false;
};
$('refAlpha').oninput = e => { ref.style.opacity = e.target.value; };

render();
