'use strict';

const $ = (id) => document.getElementById(id);

const KEY = 'nube-palabras-v2';
const KEY_OLD = 'nube-palabras-v1';
const DENSITY_MAX = 15;
const POINTER_RADIUS = 120;
const LEVEL_CHANGE_INTERVAL = 8000;

const SEEDS = [
  { word: 'silencio', level: 5, desc: 'el hueco donde nacen las palabras.' },
  { word: 'luz', level: 4, desc: 'la primera que aparece cuando todo se apaga.' },
  { word: 'mar', level: 3, desc: 'el ruido de fondo donde flotan las ideas.' },
  { word: 'viento', level: 2, desc: 'lo que mueve las hojas sin pedir permiso.' },
  { word: 'arena', level: 1, desc: 'lo que queda cuando se va la ola.' },
  { word: 'estrellas', level: 5, desc: 'puntos que ordenan la noche.' },
  { word: 'nube', level: 3, desc: 'donde viven los pensamientos prestados.' },
  { word: 'raíz', level: 2, desc: 'el origen que nunca se ve.' },
  { word: 'hoja', level: 1, desc: 'una página que cae cada otoño.' },
  { word: 'pozo', level: 2, desc: 'profundo, frío y siempre oscuro.' },
  { word: 'caminos', level: 4, desc: 'todas las formas de llegar al mismo lugar.' },
  { word: 'eco', level: 1, desc: 'una palabra repetida por la distancia.' }
];

const canvas = $('wordCloud');
const ctx = canvas.getContext('2d');

let words = [];
let idSeq = 1;
let levelSel = 3;
let editingId = null;

let width = 0;
let height = 0;
let dpr = 1;
let isMobile = false;

const pointer = { x: -1000, y: -1000, radius: POINTER_RADIUS, isActive: false };
let activeWord = null;
let selectedWord = null;

let mqMobile = window.matchMedia('(max-width: 640px)');
let densityExpanded = false;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function randomLevel() {
  const r = Math.random();
  if (r < .20) return 1;
  if (r < .48) return 2;
  if (r < .76) return 3;
  if (r < .92) return 4;
  return 5;
}

function weightOf(level) {
  return clamp(level, 1, 5);
}

function fontSizeFor(weight) {
  const base = isMobile ? Math.min(width * 0.036, 16) : Math.min(width * 0.025, 22);
  const scale = isMobile ? 2.8 : 3.8;
  return base + weight * scale;
}

function fontFor(weight, size) {
  const w = weight >= 7 ? 700 : weight >= 5 ? 500 : 300;
  return `${w} ${size}px 'Space Grotesk', 'Inter', system-ui, sans-serif`;
}

function opacityFor(weight) {
  return 0.3 + (weight / 10) * 0.65;
}

/* ---------- persistencia ---------- */

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(words)); } catch (e) {}
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length) return data;
    }
    const oldRaw = localStorage.getItem(KEY_OLD);
    if (oldRaw) {
      const data = JSON.parse(oldRaw);
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (e) {}
  return null;
}

/* ---------- motor de palabras ---------- */

function visibleWords() {
  const sorted = [...words].sort((a, b) => b.level - a.level || a.id - b.id);
  if (isMobile && !densityExpanded) return sorted.slice(0, DENSITY_MAX);
  return sorted;
}

function resolveCollisions() {
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i];
      const b = words[j];
      if (a.hidden || b.hidden) continue;
      const w = (a.width + b.width) / 2 + 12;
      const h = (a.height + b.height) / 2 + 8;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const nx = Math.abs(dx);
      const ny = Math.abs(dy);
      if (nx < w && ny < h) {
        const ox = (w - nx) * (dx >= 0 ? 1 : -1);
        const oy = (h - ny) * (dy >= 0 ? 1 : -1);
        if (Math.abs(ox) < Math.abs(oy)) {
          a.x -= ox / 2;
          b.x += ox / 2;
        } else {
          a.y -= oy / 2;
          b.y += oy / 2;
        }
      }
    }
  }
}

let centerX = 0;
let centerY = 0;

function ringRadius(level) {
  const maxR = isMobile
    ? Math.min(width, height) * 0.34
    : Math.min(width, height) * 0.24;
  const minR = isMobile ? Math.max(30, maxR * 0.22) : Math.max(40, maxR * 0.25);
  const step = (maxR - minR) / 4;
  return minR + (5 - clamp(level, 1, 5)) * step;
}

function randomRing() {
  return Math.floor(Math.random() * 5) + 1;
}

function ringSpeedFor(ring) {
  const base = isMobile ? 0.06 : 0.035;
  const inc = isMobile ? 0.010 : 0.007;
  return base + (5 - clamp(ring, 1, 5)) * inc;
}

function ringTarget(w) {
  const R = ringRadius(w.ring);
  const xRatio = isMobile ? 0.55 : 0.6;
  const yRatio = isMobile ? 1.1 : 1.05;
  return {
    x: centerX + R * Math.cos(w.ringAngle) * xRatio,
    y: centerY + R * Math.sin(w.ringAngle) * yRatio
  };
}

function initWords() {
  centerX = width / 2;
  centerY = height / 2;
  const sorted = visibleWords();

  words.forEach((w) => { w.hidden = true; });

  for (const w of sorted) {
    w.hidden = false;
    w.weight = weightOf(w.level);
    w.targetFontSize = fontSizeFor(w.weight);
    if (w.ring === undefined) w.ring = randomRing();
    w.ringSpeed = ringSpeedFor(w.ring);
    if (w.ringAngle === undefined) {
      w.ringAngle = Math.random() * Math.PI * 2;
    }
  }

  const byRing = {};
  for (const w of sorted) {
    if (w.hidden) continue;
    (byRing[w.ring] = byRing[w.ring] || []).push(w);
  }
  for (const ring in byRing) {
    const group = byRing[ring];
    group.forEach((w, index) => {
      w.ringAngle = (index / Math.max(1, group.length)) * Math.PI * 2
        + (Math.random() - 0.5) * 0.3;
      const t = ringTarget(w);
      if (!isFinite(t.x) || !isFinite(t.y)) {
        t.x = centerX;
        t.y = centerY;
      }
      w.x = t.x;
      w.y = t.y;
      w.originX = t.x;
      w.originY = t.y;
      if (w.vx === undefined) {
        w.vx = (Math.random() - 0.5) * 0.2;
        w.vy = (Math.random() - 0.5) * 0.2;
        w.angle = Math.random() * Math.PI * 2;
        w.speed = 0.010 + Math.random() * 0.012;
      }
      w.hoverScale = 1;
      w.width = 0;
      w.height = 0;
      if (w.currentFontSize === undefined) w.currentFontSize = 0;
      if (w.currentFontSize > 0) w.revealT = Infinity;
      else w.revealT = -index * 90;
    });
  }

  for (let k = 0; k < 40; k++) {
    words.forEach(measure);
    resolveCollisions();
  }
}

function measure(w) {
  const size = Math.max(1, w.currentFontSize * w.hoverScale);
  ctx.font = fontFor(w.weight, size);
  const t = w.width;
  w.width = ctx.measureText(w.word).width;
  w.height = size;
}

function updateWord(w, dt) {
  const k = Math.min(1, dt * 60);
  w.revealT += dt * 1000;
  if (w.revealT > 0) {
    w.currentFontSize += (w.targetFontSize - w.currentFontSize) * 0.05 * k;
  }

  if (!isFinite(w.ringAngle)) w.ringAngle = 0;
  w.ringAngle += w.ringSpeed * dt;
  const t = ringTarget(w);
  w.originX = t.x;
  w.originY = t.y;
  if (!isFinite(w.x) || !isFinite(w.y)) {
    w.x = t.x;
    w.y = t.y;
  }

  w.angle += w.speed;
  const osc = isMobile ? 0.10 : 0.06;
  const anchor = isMobile ? 0.018 : 0.025;
  w.x += w.vx + Math.sin(w.angle) * osc;
  w.y += w.vy + Math.cos(w.angle) * osc;

  w.x += (w.originX - w.x) * anchor;
  w.y += (w.originY - w.y) * anchor;

  const margin = isMobile ? 35 : 50;
  w.x = clamp(w.x, margin, width - margin);
  w.y = clamp(w.y, margin, height - margin);

  measure(w);

  const dx = pointer.x - w.x;
  const dy = pointer.y - w.y;
  const dist = Math.hypot(dx, dy);

  if (dist < pointer.radius && pointer.x > 0) {
    const factor = 1 - dist / pointer.radius;
    w.hoverScale += (1.25 - w.hoverScale) * 0.1 * k;
    if (dist > 0.01) {
      w.x -= (dx / dist) * factor * 1.5;
      w.y -= (dy / dist) * factor * 1.5;
    }
    if (dist < Math.max(w.width / 2, 20)) activeWord = w;
  } else {
    w.hoverScale += (1 - w.hoverScale) * 0.08 * k;
  }
}

function drawWord(w) {
  if (w.hidden) return;
  const size = Math.max(1, w.currentFontSize * w.hoverScale);
  ctx.font = fontFor(w.weight, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const isHovered = activeWord === w;
  const isSelected = selectedWord === w;

  ctx.shadowBlur = isHovered ? 20 : 8;
  ctx.shadowColor = isHovered
    ? 'rgba(255,255,255,0.5)'
    : 'rgba(150,170,255,0.18)';

  ctx.strokeStyle = isSelected
    ? 'rgba(150,200,255,0.35)'
    : 'rgba(0,0,0,0.3)';
  ctx.lineWidth = isSelected ? 2.5 : 2;
  ctx.lineJoin = 'round';
  ctx.strokeText(w.word, w.x, w.y);

  ctx.fillStyle = isHovered
    ? 'rgba(255,255,255,1)'
    : isSelected
      ? 'rgba(220,235,255,1)'
      : `rgba(228,228,231,${opacityFor(w.weight).toFixed(3)})`;
  ctx.fillText(w.word, w.x, w.y);
  ctx.shadowBlur = 0;
}

function selectWord(w) {
  selectedWord = w;
  const panel = $('info-panel');
  $('infoWord').textContent = w.word;
  const d = w.desc.trim();
  $('infoDesc').textContent = d || '';
  panel.classList.add('show');
}

function deselectWord() {
  selectedWord = null;
  $('info-panel').classList.remove('show');
}

function updateInfoPanel() {
  if (!selectedWord) return;
  if (selectedWord.hidden) {
    deselectWord();
    return;
  }
  $('infoWord').textContent = selectedWord.word;
  const d = selectedWord.desc.trim();
  $('infoDesc').textContent = d || '';
}

/* ---------- loop ---------- */

let lastT = performance.now();
let driftTimer = 0;
function loop(t) {
  const dt = clamp((t - lastT) / 1000, 0, 0.05);
  lastT = t;

  driftTimer += dt;
  if (driftTimer >= LEVEL_CHANGE_INTERVAL / 1000) {
    driftTimer = 0;
    autoDriftLevel();
  }

  ctx.clearRect(0, 0, width, height);
  activeWord = null;

  for (const w of words) {
    if (w.hidden) continue;
    updateWord(w, dt);
  }
  for (let k = 0; k < 4; k++) {
    words.forEach(measure);
    resolveCollisions();
  }
  for (const w of words) {
    if (!w.hidden) drawWord(w);
  }
  updateInfoPanel();

  requestAnimationFrame(loop);
}

/* ---------- canvas / layout ---------- */

function resize() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  isMobile = mqMobile.matches;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initWords();
  applyDensity();
}

function relayout() {
  initWords();
}

/* ---------- migración automática de nivel ---------- */

function setWordLevel(w, level) {
  const lv = clamp(Math.round(level), 1, 5);
  if (lv === w.level) return false;
  w.level = lv;
  w.weight = weightOf(lv);
  w.targetFontSize = fontSizeFor(w.weight);
  return true;
}

function autoDriftLevel() {
  const visible = words.filter((w) => !w.hidden);
  if (!visible.length) return;
  const w = visible[Math.floor(Math.random() * visible.length)];
  const dir = Math.random() < 0.5 ? -1 : 1;
  setWordLevel(w, w.level + dir);
}

/* ---------- interacción con puntero ---------- */

function hitTest(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const w of words) {
    if (w.hidden) continue;
    const d = Math.hypot(x - w.x, y - w.y);
    const r = Math.max(w.width / 2, 24);
    if (d < r && d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

let downPos = { x: 0, y: 0 };
let didMove = false;
let lastClick = 0;

function onPointerDown(e) {
  downPos = { x: e.clientX, y: e.clientY };
  didMove = false;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.isActive = true;
}

function onPointerMove(e) {
  if (e.pointerType === 'touch' && !didMove) {
    const dx = e.clientX - downPos.x;
    const dy = e.clientY - downPos.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) {
      didMove = true;
    }
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.isActive = true;
}

function onPointerUp(e) {
  if (didMove) return;
  const w = hitTest(e.clientX, e.clientY);
  const now = performance.now();
  if (now - lastClick < 300 && w) {
    lastClick = 0;
    deselectWord();
    openForm(w);
    return;
  }
  lastClick = now;
  if (w) {
    selectWord(w);
  } else {
    deselectWord();
  }
}

function onPointerLeave() {
  pointer.x = -1000;
  pointer.y = -1000;
  pointer.isActive = false;
  activeWord = null;
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointerleave', onPointerLeave);

/* ---------- CRUD ---------- */

function openForm(word) {
  deselectWord();
  editingId = word ? word.id : null;
  $('formTitle').textContent = word ? 'editar palabra' : 'nueva palabra';
  $('wordInput').value = word ? word.word : '';
  $('descInput').value = word ? word.desc : '';
  levelSel = word ? word.level : levelSel;
  $('autoRandom').checked = false;
  $('formDelete').style.display = word ? 'block' : 'none';
  $('addBtn').textContent = word ? 'guardar cambios' : 'agregar a la nube';
  paintDots();
  $('formMask').classList.add('open');
  setTimeout(() => $('wordInput').focus(), 140);
}

function closeForm() {
  $('formMask').classList.remove('open');
  $('addBtn').textContent = 'agregar a la nube';
  editingId = null;
}

function submitWord() {
  const wordText = $('wordInput').value.trim().replace(/\s+/g, ' ');
  if (!wordText) {
    $('wordInput').focus();
    return;
  }
  const level = $('autoRandom').checked ? randomLevel() : levelSel;
  const desc = $('descInput').value.trim();

  if (editingId) {
    const w = words.find((x) => x.id === editingId);
    if (w) {
      w.word = wordText;
      setWordLevel(w, level);
      w.desc = desc;
    }
    closeForm();
    save();
    relayout();
    applyDensity();
    toast('palabra actualizada');
    return;
  }

  words.push({
    id: idSeq++,
    word: wordText,
    level,
    desc,
    currentFontSize: 0,
    hidden: false
  });
  closeForm();
  save();
  relayout();
  applyDensity();
  toast('palabra agregada');
}

function removeWord(w) {
  words = words.filter((x) => x.id !== w.id);
  save();
  relayout();
  applyDensity();
  toast('palabra eliminada');
}

function paintDots() {
  const dots = $('levelDots');
  dots.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot' + (i <= levelSel ? ' on' : '');
    b.title = 'nivel ' + i;
    b.addEventListener('click', () => setLevel(i));
    dots.appendChild(b);
  }
  $('levelNum').textContent = 'nivel ' + levelSel;
}

function setLevel(n) {
  levelSel = n;
  paintDots();
}

function applyDensity() {
  const chip = $('densityChip');
  const show = mqMobile.matches && words.length > DENSITY_MAX;
  chip.style.display = show ? 'block' : 'none';
  chip.textContent = densityExpanded
    ? 'ver menos'
    : `ver todas (+${words.length - DENSITY_MAX})`;
}

function toggleDensity() {
  densityExpanded = !densityExpanded;
  relayout();
  applyDensity();
  toast(densityExpanded ? 'mostrando todas' : 'solo las más relevantes');
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- UI ---------- */

$('hotspot').addEventListener('click', () => {
  $('hotspot').classList.toggle('open');
  if ($('formMask').classList.contains('open')) closeForm();
  else openForm();
});

$('formClose').addEventListener('click', () => {
  $('hotspot').classList.remove('open');
  closeForm();
});

$('formMask').addEventListener('click', (e) => {
  if (e.target === $('formMask')) {
    $('hotspot').classList.remove('open');
    closeForm();
  }
});

$('wordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitWord();
});

$('descInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitWord();
  }
});

$('addBtn').addEventListener('click', submitWord);
$('diceBtn').addEventListener('click', () => setLevel(randomLevel()));

$('infoEdit').addEventListener('click', () => {
  if (selectedWord) {
    const w = selectedWord;
    deselectWord();
    openForm(w);
  }
});

$('formDelete').addEventListener('click', () => {
  if (editingId) {
    const w = words.find((x) => x.id === editingId);
    if (w) {
      closeForm();
      removeWord(w);
    }
  }
});

$('densityChip').addEventListener('click', toggleDensity);

try { mqMobile.addEventListener('change', () => { resize(); }); }
catch (e) { mqMobile.addListener(() => { resize(); }); }

window.addEventListener('resize', debounce(resize, 200));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('formMask').classList.contains('open')) {
      $('hotspot').classList.remove('open');
      closeForm();
    } else {
      deselectWord();
    }
  }
});

/* ---------- fondo de estrellas ---------- */

(function makeStars() {
  const box = $('stars');
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    const sz = Math.random() * 2 + 1;
    s.style.cssText =
      `left:${(Math.random() * 100).toFixed(2)}%;` +
      `top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${sz.toFixed(2)}px;height:${sz.toFixed(2)}px;` +
      `--o:${(Math.random() * 0.5 + 0.15).toFixed(2)};` +
      `animation-delay:${(Math.random() * 6).toFixed(2)}s;` +
      `animation-duration:${(3 + Math.random() * 5).toFixed(2)}s;`;
    box.appendChild(s);
  }
})();

/* ---------- inicio ---------- */

function init() {
  paintDots();

  let data = load();
  if (!data) data = SEEDS.map((s) => ({ ...s }));

  for (const s of data) {
    words.push({
      id: idSeq++,
      word: s.word,
      level: s.level || randomLevel(),
      desc: s.desc || '',
      currentFontSize: 0,
      hidden: false
    });
  }

  resize();
  save();
  console.log('nube-palabras: palabras visibles =', words.filter((w) => !w.hidden).length);
  console.log('nube-palabras: primera palabra =', JSON.stringify(words[0]));
  requestAnimationFrame(loop);
}

init();
