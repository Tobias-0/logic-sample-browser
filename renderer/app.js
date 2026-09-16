'use strict';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROW_H = 40;
const BPM_FLOOR = 60;
const BPM_CEIL = 200;

const $ = (id) => document.getElementById(id);

const state = {
  all: [],
  view: [],
  favs: new Set(),
  sel: new Set(),        // selected paths
  cursor: -1,            // index into view
  anchor: -1,
  playingPath: null,
  sort: { key: 'name', dir: 1 },
  tempo: { bpm: 137, ratio: 'off' },   // ratio: 'off' | '0.5' | '1' | '2'
  filters: {
    q: '',
    format: null,        // 'Loop' | 'One-shot' | null
    favOnly: false,
    notes: new Set(),
    scale: null,         // 'min' | 'maj' | null
    styles: new Set(),
    packs: new Set(),
    bpmMin: BPM_FLOOR,
    bpmMax: BPM_CEIL,
    bpmUntagged: true,
  },
};

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
const fileURL = (p) =>
  'file://' + p.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');

const fmtTime = (s) => {
  if (s == null) return '—';
  if (s < 10) return s.toFixed(2).replace(/0$/, '') + 's';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${Math.round(s)}s`;
};

const fmtCount = (n) => n.toLocaleString('en-US');

const bpmDefault = () =>
  state.filters.bpmMin === BPM_FLOOR &&
  state.filters.bpmMax === BPM_CEIL &&
  state.filters.bpmUntagged;

/* ------------------------------------------------------------------ *
 * filtering — each predicate is separable so facet counts can exclude
 * their own dimension.
 * ------------------------------------------------------------------ */
const P = {
  q: (s) => {
    const q = state.filters.q;
    if (!q) return true;
    return s._hay.includes(q);
  },
  format: (s) => !state.filters.format || s.format === state.filters.format,
  fav: (s) => !state.filters.favOnly || state.favs.has(s.path),
  note: (s) => {
    const f = state.filters;
    if (f.notes.size && !(s.note && f.notes.has(s.note))) return false;
    if (f.scale && s.scale !== f.scale) return false;
    return true;
  },
  style: (s) => !state.filters.styles.size || state.filters.styles.has(s.style),
  pack: (s) => !state.filters.packs.size || state.filters.packs.has(s.pack),
  bpm: (s) => {
    const f = state.filters;
    if (s.bpm == null) return f.bpmUntagged;
    return s.bpm >= f.bpmMin && s.bpm <= f.bpmMax;
  },
};

const ALL_KEYS = Object.keys(P);
function passes(s, except) {
  for (const k of ALL_KEYS) {
    if (k === except) continue;
    if (!P[k](s)) return false;
  }
  return true;
}
const passesAll = (s) => passes(s, null);

function compare(a, b) {
  const { key, dir } = state.sort;
  let x, y;
  if (key === 'note') {
    x = a.note ? NOTES.indexOf(a.note) : 99;
    y = b.note ? NOTES.indexOf(b.note) : 99;
  } else if (key === 'bpm' || key === 'duration') {
    x = a[key] == null ? Infinity : a[key];
    y = b[key] == null ? Infinity : b[key];
  } else {
    x = (a[key] || '').toLowerCase();
    y = (b[key] || '').toLowerCase();
  }
  if (x < y) return -dir;
  if (x > y) return dir;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

function recompute() {
  state.view = state.all.filter(passesAll).sort(compare);
  $('count').textContent = `${fmtCount(state.view.length)} of ${fmtCount(state.all.length)}`;
  renderFacets();
  renderRows(true);
  const empty = $('empty');
  empty.hidden = state.view.length > 0;
  if (!state.view.length) {
    empty.innerHTML = state.all.length
      ? 'No samples match these filters.<br><span style="color:var(--accent)">Loosen a filter, or clear them all.</span>'
      : 'No audio found in this folder.';
  }
}

/* ------------------------------------------------------------------ *
 * facets
 * ------------------------------------------------------------------ */
function countBy(key, except) {
  const m = new Map();
  for (const s of state.all) {
    if (!passes(s, except)) continue;
    const v = s[key];
    if (v == null) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function markActive(el, on) {
  el.closest('.facet').classList.toggle('active', on);
}

function renderFacets() {
  const f = state.filters;

  /* type ---------------------------------------------------------- */
  const fmtCounts = countBy('format', 'format');
  const favCount = state.all.filter((s) => state.favs.has(s.path) && passes(s, 'fav')).length;
  $('f-format').innerHTML = '';
  const addChip = (parent, label, pressed, onClick, badge) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.textContent = badge == null ? label : `${label} ${badge}`;
    b.onclick = onClick;
    parent.appendChild(b);
    return b;
  };
  addChip($('f-format'), 'All', !f.format && !f.favOnly, () => {
    f.format = null; f.favOnly = false; recompute();
  });
  for (const v of ['Loop', 'One-shot']) {
    addChip($('f-format'), v, f.format === v, () => {
      f.format = f.format === v ? null : v; recompute();
    }, fmtCounts.get(v) || 0);
  }
  addChip($('f-format'), '★', f.favOnly, () => {
    f.favOnly = !f.favOnly; recompute();
  }, favCount);

  /* note ---------------------------------------------------------- */
  const noteCounts = countBy('note', 'note');
  const keys = $('f-note');
  keys.innerHTML = '';
  for (const n of NOTES) {
    const b = document.createElement('button');
    b.className = 'key' + (n.includes('#') ? ' sharp' : '');
    b.type = 'button';
    b.textContent = n;
    const c = noteCounts.get(n) || 0;
    b.disabled = c === 0 && !f.notes.has(n);
    b.title = `${c} samples`;
    b.setAttribute('aria-pressed', String(f.notes.has(n)));
    b.onclick = () => {
      f.notes.has(n) ? f.notes.delete(n) : f.notes.add(n);
      recompute();
    };
    keys.appendChild(b);
  }
  const scaleCounts = countBy('scale', 'note');
  $('f-scale').innerHTML = '';
  for (const [v, label] of [['min', 'Minor'], ['maj', 'Major']]) {
    addChip($('f-scale'), label, f.scale === v, () => {
      f.scale = f.scale === v ? null : v; recompute();
    }, scaleCounts.get(v) || 0);
  }
  markActive(keys, f.notes.size > 0 || !!f.scale);

  /* style --------------------------------------------------------- */
  const styleCounts = countBy('style', 'style');
  renderOptions($('f-style'), styleCounts, f.styles, (v) => {
    f.styles.has(v) ? f.styles.delete(v) : f.styles.add(v);
    recompute();
  });
  markActive($('f-style'), f.styles.size > 0);

  /* pack ---------------------------------------------------------- */
  const packCounts = countBy('pack', 'pack');
  const pq = $('pack-search').value.trim().toLowerCase();
  const filtered = new Map(
    [...packCounts].filter(([k]) => !pq || k.toLowerCase().includes(pq))
  );
  renderOptions($('f-pack'), filtered, f.packs, (v) => {
    f.packs.has(v) ? f.packs.delete(v) : f.packs.add(v);
    recompute();
  }, 300);
  markActive($('f-pack'), f.packs.size > 0);

  markActive($('bpm-hist'), !bpmDefault());
  drawHistogram();
}

function renderOptions(host, counts, selected, onToggle, limit) {
  for (const v of selected) if (!counts.has(v)) counts.set(v, 0);
  // Selected options stay pinned to the top; otherwise narrowing a facet can
  // push your own choice out of sight, since counts exclude that facet.
  const entries = [...counts].sort((a, b) => {
    const sa = selected.has(a[0]) ? 1 : 0;
    const sb = selected.has(b[0]) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  host.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const [label, n] of entries.slice(0, limit || entries.length)) {
    const b = document.createElement('button');
    b.className = 'opt' + (n === 0 ? ' zero' : '');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(selected.has(label)));
    b.innerHTML = `<span class="box"></span><span class="lbl"></span><span class="n">${fmtCount(n)}</span>`;
    b.querySelector('.lbl').textContent = label;
    b.title = label;
    b.onclick = () => onToggle(label);
    frag.appendChild(b);
  }
  host.appendChild(frag);
}

/* ------------------------------------------------------------------ *
 * bpm histogram + range
 * ------------------------------------------------------------------ */
function drawHistogram() {
  const cv = $('bpm-hist');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 240;
  const h = 40;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const span = BPM_CEIL - BPM_FLOOR;
  const bins = new Array(span).fill(0);
  for (const s of state.all) {
    if (s.bpm == null || !passes(s, 'bpm')) continue;
    const i = Math.min(span - 1, Math.max(0, s.bpm - BPM_FLOOR));
    bins[i]++;
  }
  const max = Math.max(1, ...bins);
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--line').trim();
  const accent = css.getPropertyValue('--accent').trim();
  const bw = w / span;
  for (let i = 0; i < span; i++) {
    if (!bins[i]) continue;
    const bpm = BPM_FLOOR + i;
    const inRange = bpm >= state.filters.bpmMin && bpm <= state.filters.bpmMax;
    const bh = Math.max(1.5, (bins[i] / max) * (h - 4));
    ctx.fillStyle = inRange ? accent : line;
    ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.5), bh);
  }
  const pct = (v) => ((v - BPM_FLOOR) / span) * 100;
  const fill = $('range-fill');
  fill.style.left = pct(state.filters.bpmMin) + '%';
  fill.style.width = (pct(state.filters.bpmMax) - pct(state.filters.bpmMin)) + '%';
}

function syncBpm(from) {
  const f = state.filters;
  let lo = parseInt($(from === 'n' ? 'bpm-min-n' : 'bpm-min').value, 10);
  let hi = parseInt($(from === 'n' ? 'bpm-max-n' : 'bpm-max').value, 10);
  if (isNaN(lo)) lo = BPM_FLOOR;
  if (isNaN(hi)) hi = BPM_CEIL;
  lo = Math.min(Math.max(lo, BPM_FLOOR), BPM_CEIL);
  hi = Math.min(Math.max(hi, BPM_FLOOR), BPM_CEIL);
  if (lo > hi) [lo, hi] = [hi, lo];
  f.bpmMin = lo;
  f.bpmMax = hi;
  $('bpm-min').value = lo; $('bpm-max').value = hi;
  $('bpm-min-n').value = lo; $('bpm-max-n').value = hi;
  recompute();
}

/* ------------------------------------------------------------------ *
 * virtual row list
 * ------------------------------------------------------------------ */
const scroller = $('scroller');
const rowsEl = $('rows');
let lastWindow = { start: -1, end: -1 };

function renderRows(reset) {
  if (reset) {
    lastWindow = { start: -1, end: -1 };
    $('spacer').style.height = state.view.length * ROW_H + 'px';
    if (reset === true) scroller.scrollTop = 0;
  }
  const top = scroller.scrollTop;
  const vh = scroller.clientHeight;
  const start = Math.max(0, Math.floor(top / ROW_H) - 6);
  const end = Math.min(state.view.length, Math.ceil((top + vh) / ROW_H) + 6);
  if (start === lastWindow.start && end === lastWindow.end) return;
  lastWindow = { start, end };

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) frag.appendChild(buildRow(state.view[i], i));
  rowsEl.innerHTML = '';
  rowsEl.style.transform = `translateY(${start * ROW_H}px)`;
  rowsEl.appendChild(frag);
}

function buildRow(s, i) {
  const el = document.createElement('div');
  el.className = 'row';
  el.dataset.i = i;
  el.draggable = true;
  el.setAttribute('aria-selected', String(state.sel.has(s.path)));
  if (state.playingPath === s.path) el.classList.add('playing');

  const fav = state.favs.has(s.path);
  const bpm = s.bpm == null
    ? '<span class="dim">—</span>'
    : `<span class="bpm-cell${s.bpmSource === 'inferred' ? ' approx' : ''}" title="${s.bpmSource === 'inferred' ? 'Estimated from length' : 'From file name'}">${s.bpmSource === 'inferred' ? '~' : ''}${s.bpm}</span>`;
  const key = s.note
    ? `<span class="key-cell">${s.note}${s.scale ? `<span class="scale">${s.scale === 'min' ? 'm' : 'M'}</span>` : ''}</span>`
    : '<span class="dim">—</span>';

  el.innerHTML = `
    <button class="fav${fav ? ' on' : ''}" title="Favourite">${fav ? '★' : '☆'}</button>
    <div class="name-cell">
      <span class="name"></span>
      <span class="sub"></span>
    </div>
    <span><span class="tag"></span></span>
    ${bpm}
    ${key}
    <span class="len-cell">${fmtTime(s.duration)}</span>
    <span class="pack-cell"></span>`;

  el.querySelector('.name').textContent = s.name;
  el.querySelector('.sub').textContent = [s.format, s.folder].filter(Boolean).join(' · ');
  el.querySelector('.tag').textContent = s.style;
  el.querySelector('.pack-cell').textContent = s.pack;
  el.title = s.path;

  el.querySelector('.fav').onclick = (e) => {
    e.stopPropagation();
    state.favs.has(s.path) ? state.favs.delete(s.path) : state.favs.add(s.path);
    window.api.setState({ favs: [...state.favs] });
    renderRows(false);
    renderFacets();
  };
  return el;
}

scroller.addEventListener('scroll', () => renderRows(false), { passive: true });
// Watch the scroller itself: its height is only final after layout settles,
// and a short first measurement would leave most rows unrendered.
new ResizeObserver(() => { lastWindow = { start: -1, end: -1 }; renderRows(false); }).observe(scroller);
new ResizeObserver(() => { drawHistogram(); drawWave(); }).observe(document.body);

/* ------------------------------------------------------------------ *
 * selection + drag
 * ------------------------------------------------------------------ */
function selectIndex(i, { additive = false, range = false, preview = true } = {}) {
  if (i < 0 || i >= state.view.length) return;
  const s = state.view[i];
  if (range && state.anchor >= 0) {
    const [a, b] = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    state.sel = new Set(state.view.slice(a, b + 1).map((x) => x.path));
  } else if (additive) {
    state.sel.has(s.path) ? state.sel.delete(s.path) : state.sel.add(s.path);
    state.anchor = i;
  } else {
    state.sel = new Set([s.path]);
    state.anchor = i;
  }
  state.cursor = i;
  lastWindow = { start: -1, end: -1 };
  renderRows(false);
  showNow(s);
  if (preview && $('autoplay').checked) play(s);
}

function scrollCursorIntoView() {
  const y = state.cursor * ROW_H;
  if (y < scroller.scrollTop) scroller.scrollTop = y;
  else if (y + ROW_H > scroller.scrollTop + scroller.clientHeight)
    scroller.scrollTop = y + ROW_H - scroller.clientHeight;
}

rowsEl.addEventListener('mousedown', (e) => {
  const row = e.target.closest('.row');
  if (!row || e.target.closest('.fav')) return;
  const i = +row.dataset.i;
  // Keep an existing multi-selection intact so it can be dragged as a group.
  if (state.sel.has(state.view[i].path) && state.sel.size > 1 && !e.metaKey && !e.shiftKey) {
    state.cursor = i;
    showNow(state.view[i]);
    return;
  }
  selectIndex(i, { additive: e.metaKey, range: e.shiftKey });
});

rowsEl.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault(); // hand the drag over to the OS
  const s = state.view[+row.dataset.i];
  const files = state.sel.has(s.path) && state.sel.size > 1 ? [...state.sel] : [s.path];
  window.api.startDrag(files);
});

rowsEl.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row');
  if (row) window.api.reveal(state.view[+row.dataset.i].path);
});

/* ------------------------------------------------------------------ *
 * audio
 * ------------------------------------------------------------------ */
const audio = new Audio();
audio.preload = 'auto';
let current = null;
const peakCache = new Map();

/* Project-tempo preview.
   Only loops with a known tempo are stretched — a one-shot has no tempo to
   match, and an unknown one would be a guess. Pitch is preserved, so a sample
   you found by filtering on F# still sounds in F# after stretching. */
function previewRate(s) {
  const t = state.tempo;
  if (!s || t.ratio === 'off') return 1;
  if (s.format !== 'Loop' || !s.bpm || !t.bpm) return 1;
  const rate = (t.bpm * Number(t.ratio)) / s.bpm;
  return rate > 0 && isFinite(rate) ? rate : 1;
}

function applyRate() {
  // Assigning a new src resets both of these, so they are set on every load.
  audio.preservesPitch = true;
  if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
  audio.playbackRate = previewRate(current);
}
audio.addEventListener('loadedmetadata', applyRate);

audio.addEventListener('play', () => document.body.classList.add('playing'));
audio.addEventListener('pause', () => document.body.classList.remove('playing'));
audio.addEventListener('ended', () => {
  document.body.classList.remove('playing');
  state.playingPath = null;
  renderRows(false);
});

function updateNowMeta() {
  const s = current;
  if (!s) return;
  const rate = previewRate(s);
  let tempoBit = null;
  if (s.bpm) {
    tempoBit = `${s.bpmSource === 'inferred' ? '~' : ''}${s.bpm} BPM`;
    if (rate !== 1) {
      const heard = Math.round(s.bpm * rate);
      tempoBit += ` → ${heard} (${rate.toFixed(2)}×)`;
    }
  } else if (state.tempo.ratio !== 'off' && s.format === 'Loop') {
    tempoBit = 'no tempo — playing native';
  }
  $('now-meta').textContent = [
    s.pack,
    tempoBit,
    s.note ? s.note + (s.scale === 'min' ? ' min' : s.scale === 'maj' ? ' maj' : '') : null,
    s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)}k · ${s.bits}bit · ${s.channels === 2 ? 'stereo' : 'mono'}` : null,
  ].filter(Boolean).join('  ·  ');
}

function showNow(s) {
  current = s;
  $('now-name').textContent = s.name;
  updateNowMeta();
  loadPeaks(s);
}

function play(s) {
  state.playingPath = s.path;
  audio.src = fileURL(s.path);
  audio.currentTime = 0;
  applyRate();
  audio.play().catch(() => {});
  renderRows(false);
}

function togglePlay() {
  if (!current) return;
  if (audio.paused || state.playingPath !== current.path) play(current);
  else audio.pause();
}

$('play').onclick = togglePlay;
$('volume').oninput = (e) => { audio.volume = e.target.value / 100; };
audio.volume = 0.8;
$('reveal').onclick = () => current && window.api.reveal(current.path);

/* waveform ---------------------------------------------------------- */
let peaks = null;
const actx = new (window.AudioContext || window.webkitAudioContext)();

async function loadPeaks(s) {
  peaks = null;
  drawWave();
  if (peakCache.has(s.path)) { peaks = peakCache.get(s.path); drawWave(); return; }
  try {
    const res = await fetch(fileURL(s.path));
    const buf = await res.arrayBuffer();
    const decoded = await actx.decodeAudioData(buf);
    if (current !== s) return;
    const N = 900;
    const ch = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / N));
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let peak = 0;
      const a = i * step;
      const b = Math.min(ch.length, a + step);
      for (let j = a; j < b; j++) { const v = Math.abs(ch[j]); if (v > peak) peak = v; }
      out[i] = peak;
    }
    peakCache.set(s.path, out);
    if (peakCache.size > 80) peakCache.delete(peakCache.keys().next().value);
    peaks = out;
    drawWave();
  } catch { /* undecodable file — leave the waveform blank */ }
}

function drawWave() {
  const cv = $('wave');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth;
  const h = 48;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!peaks) return;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--line').trim();
  const mid = h / 2;
  const bw = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const ph = Math.max(0.5, peaks[i] * (h / 2 - 2));
    ctx.fillRect(i * bw, mid - ph, Math.max(0.6, bw * 0.8), ph * 2);
  }
}

function tick() {
  if (!audio.paused && audio.duration) {
    const p = audio.currentTime / audio.duration;
    const wrap = document.querySelector('.wave-wrap');
    $('playhead').style.left = p * wrap.clientWidth + 'px';
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.querySelector('.wave-wrap').onclick = (e) => {
  if (!current || !audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
};

/* ------------------------------------------------------------------ *
 * tempo controls
 * ------------------------------------------------------------------ */
function syncTempoUI() {
  const t = state.tempo;
  $('tempo-bpm').value = t.bpm;
  for (const b of document.querySelectorAll('#tempo-seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.ratio === t.ratio));
  }
  document.querySelector('.tempo').classList.toggle('off', t.ratio === 'off');
  applyRate();       // takes effect mid-playback, no need to retrigger
  updateNowMeta();
  window.api.setState({ tempo: t });
}

for (const b of document.querySelectorAll('#tempo-seg button')) {
  b.onclick = () => { state.tempo.ratio = b.dataset.ratio; syncTempoUI(); };
}
$('tempo-bpm').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  if (!isNaN(v) && v >= 40 && v <= 300) { state.tempo.bpm = v; syncTempoUI(); }
});
$('tempo-bpm').addEventListener('change', (e) => {
  let v = parseInt(e.target.value, 10);
  if (isNaN(v)) v = state.tempo.bpm;
  state.tempo.bpm = Math.min(300, Math.max(40, v));
  syncTempoUI();
});

/* ------------------------------------------------------------------ *
 * theme
 * ------------------------------------------------------------------ */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let themePref = 'system';   // 'system' | 'light' | 'dark'

function applyTheme(pref, { persist = false } = {}) {
  themePref = pref;
  const resolved = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === pref));
  }
  // Canvases paint with resolved custom-property values, so they need a repaint.
  drawHistogram();
  drawWave();
  // Let the native window chrome (traffic lights, background) follow along.
  if (window.api.setTheme) window.api.setTheme(pref);
  if (persist) window.api.setState({ theme: pref });
}

darkQuery.addEventListener('change', () => {
  if (themePref === 'system') applyTheme('system');
});

for (const b of document.querySelectorAll('#theme-seg button')) {
  b.onclick = () => applyTheme(b.dataset.themeChoice, { persist: true });
}

// Resolve the system preference immediately so the first paint is not a flash
// of the wrong theme; the saved preference lands a moment later during load().
document.documentElement.dataset.theme = darkQuery.matches ? 'dark' : 'light';

/* settings panel ---------------------------------------------------- */
const panel = $('settings-panel');
const settingsBtn = $('settings');

function setPanel(open) {
  panel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
}

settingsBtn.onclick = (e) => {
  e.stopPropagation();
  setPanel(panel.hidden);
};
panel.onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => setPanel(false));

/* ------------------------------------------------------------------ *
 * controls
 * ------------------------------------------------------------------ */
let qTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    state.filters.q = e.target.value.trim().toLowerCase();
    recompute();
  }, 110);
});
$('pack-search').addEventListener('input', renderFacets);

for (const id of ['bpm-min', 'bpm-max']) $(id).addEventListener('input', () => syncBpm('r'));
for (const id of ['bpm-min-n', 'bpm-max-n']) $(id).addEventListener('change', () => syncBpm('n'));
$('bpm-untagged').addEventListener('change', (e) => {
  state.filters.bpmUntagged = e.target.checked;
  recompute();
});

document.querySelectorAll('[data-clear]').forEach((b) => {
  b.onclick = () => {
    const f = state.filters;
    const k = b.dataset.clear;
    if (k === 'bpm') {
      f.bpmMin = BPM_FLOOR; f.bpmMax = BPM_CEIL; f.bpmUntagged = true;
      $('bpm-min').value = BPM_FLOOR; $('bpm-max').value = BPM_CEIL;
      $('bpm-min-n').value = BPM_FLOOR; $('bpm-max-n').value = BPM_CEIL;
      $('bpm-untagged').checked = true;
    }
    if (k === 'note') { f.notes.clear(); f.scale = null; }
    if (k === 'style') f.styles.clear();
    if (k === 'pack') f.packs.clear();
    recompute();
  };
});

document.querySelectorAll('.sortable').forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.sort;
    if (state.sort.key === k) state.sort.dir *= -1;
    else state.sort = { key: k, dir: 1 };
    document.querySelectorAll('.sortable').forEach((x) => x.removeAttribute('data-dir'));
    b.dataset.dir = state.sort.dir === 1 ? '↑' : '↓';
    recompute();
  };
});

$('autoplay').addEventListener('change', (e) => window.api.setState({ autoplay: e.target.checked }));
$('rescan').onclick = () => load(true);
$('choose').onclick = async () => {
  const picked = await window.api.chooseRoot();
  setPanel(false);
  if (picked) load(true);
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) { setPanel(false); return; }
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault(); $('search').focus(); $('search').select(); return;
  }
  if (typing) {
    if (e.key === 'Escape') e.target.blur();
    if (e.key === 'ArrowDown' && e.target.id === 'search') { e.preventDefault(); $('search').blur(); selectIndex(0); }
    return;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); selectIndex(state.cursor + 1); scrollCursorIntoView(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectIndex(state.cursor - 1); scrollCursorIntoView(); }
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Enter' && current) window.api.reveal(current.path);
  else if (e.key === 'f' && current) {
    state.favs.has(current.path) ? state.favs.delete(current.path) : state.favs.add(current.path);
    window.api.setState({ favs: [...state.favs] });
    renderRows(false); renderFacets();
  }
});

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */
window.api.onProgress(({ done, total }) => {
  $('loading-text').textContent = total
    ? `Reading ${fmtCount(done)} of ${fmtCount(total)} samples…`
    : `Found ${fmtCount(done)} samples…`;
});

async function load(rescan) {
  $('loading').hidden = false;
  $('loading-text').textContent = rescan ? 'Rescanning library…' : 'Loading library…';
  const saved = await window.api.getState();
  state.favs = new Set(saved.favs || []);
  applyTheme(saved.theme || 'system');
  if (saved.tempo && saved.tempo.bpm) state.tempo = { ...state.tempo, ...saved.tempo };
  if (saved.autoplay === false) $('autoplay').checked = false;
  syncTempoUI();
  const data = await window.api.loadLibrary({ rescan });
  state.all = data.samples.map((s) => ({
    ...s,
    _hay: `${s.name} ${s.pack} ${s.folder} ${s.style} ${s.genre || ''}`.toLowerCase(),
  }));
  $('panel-path').textContent = data.root;
  document.querySelector('.sortable[data-sort="name"]').dataset.dir = '↑';
  recompute();
  $('loading').hidden = true;
  requestAnimationFrame(() => { lastWindow = { start: -1, end: -1 }; renderRows(false); });
  if (data.missing) {
    $('empty').hidden = false;
    $('empty').innerHTML =
      `Couldn't find <code>${data.root}</code>.<br>Use <b>Folder…</b> above to pick your sample folder.`;
  }
}

load(false);
