'use strict';
const fs = require('fs');
const path = require('path');

const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg']);

/* ------------------------------------------------------------------ *
 * WAV header reading — duration, sample rate, channels, bit depth.
 * Reads only the first few KB, so scanning thousands of files is fast.
 * ------------------------------------------------------------------ */
function readWavHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const read = fs.readSync(fd, buf, 0, 8192, 0);
    if (read < 44) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

    let pos = 12;
    let fmt = null;
    let dataBytes = null;
    while (pos + 8 <= read) {
      const id = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (id === 'fmt ' && pos + 8 + 16 <= read) {
        fmt = {
          channels: buf.readUInt16LE(pos + 10),
          sampleRate: buf.readUInt32LE(pos + 12),
          byteRate: buf.readUInt32LE(pos + 16),
          bits: buf.readUInt16LE(pos + 22),
        };
      } else if (id === 'data') {
        dataBytes = size;
        break;
      }
      pos += 8 + size + (size % 2);
    }
    if (!fmt) return null;
    // Some files declare a bogus data size; fall back to actual file length.
    const fileSize = fs.fstatSync(fd).size;
    if (dataBytes == null || dataBytes === 0 || dataBytes > fileSize) dataBytes = fileSize - pos - 8;
    const bytesPerFrame = Math.max(1, (fmt.bits / 8) * fmt.channels);
    const duration = dataBytes / (bytesPerFrame * fmt.sampleRate);
    return { ...fmt, duration: duration > 0 && isFinite(duration) ? duration : null };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/* ------------------------------------------------------------------ *
 * BPM
 * ------------------------------------------------------------------ */
const BPM_MIN = 60;
const BPM_MAX = 200;
// Drum-machine model numbers that look exactly like tempos.
const MACHINE_NUMBERS = new Set([505, 606, 626, 707, 727, 808, 909, 950, 999]);

function bpmCandidates(text) {
  const out = [];
  // "128bpm", "bpm 128", "128 bpm"
  const explicit = /(\d{2,3})\s*[_\- ]?\s*bpm|bpm\s*[_\- ]?\s*(\d{2,3})/gi;
  let m;
  while ((m = explicit.exec(text))) {
    const n = parseInt(m[1] || m[2], 10);
    if (n >= BPM_MIN && n <= BPM_MAX) out.push({ bpm: n, score: 100 });
  }
  if (out.length) return out;

  // Bare numbers used as tempo tokens.
  const bare = /(?:^|[^0-9a-z])(\d{2,3})(?![0-9])/gi;
  while ((m = bare.exec(text))) {
    const raw = m[1];
    const n = parseInt(raw, 10);
    if (n < BPM_MIN || n > BPM_MAX) continue;
    if (MACHINE_NUMBERS.has(n)) continue;
    if (raw.length === 3 && raw[0] === '0') continue; // "015_" index prefix
    const at = m.index + m[0].length - raw.length;
    const before = text.slice(Math.max(0, at - 14), at).toLowerCase();
    const after = text.slice(at + raw.length, at + raw.length + 10).toLowerCase();
    // Reject obvious non-tempo contexts.
    if (/(vol|version|ver|part|pt|take|no|nr|num|#|v)[_\- .]?$/.test(before)) continue;
    if (/^(hz|khz|db|bit|%)/.test(after)) continue;
    let score = 50;
    if (raw.length === 3) score += 10;                 // 3 digits reads more like a tempo
    if (at === 0 && /^[_\- ]/.test(after)) score -= 25; // leading index number
    if (/(loop|beat|tempo|groove)/.test(before) || /^[_\- ]?(loop|beat)/.test(after)) score += 15;
    out.push({ bpm: n, score });
  }

  // Tempo glued onto a short abbreviation: "drm124", "vox126", "atm123".
  const glued = /(?:^|[^a-z0-9])([a-z]{2,4})(\d{2,3})(?![0-9])/gi;
  while ((m = glued.exec(text))) {
    const n = parseInt(m[2], 10);
    if (n < BPM_MIN || n > BPM_MAX) continue;
    if (MACHINE_NUMBERS.has(n)) continue;
    if (m[2].length === 3 && m[2][0] === '0') continue;
    if (/^(vol|ver|pt|no|nr|mp|kb|hz)$/i.test(m[1])) continue;
    out.push({ bpm: n, score: 30 });
  }
  return out;
}

// Does this tempo divide the clip into a musically sane number of bars?
function barFit(duration, bpm) {
  if (!duration || duration < 0.4) return null;
  const barSec = (60 / bpm) * 4;
  const bars = duration / barSec;
  for (const target of [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
    if (Math.abs(bars - target) <= Math.max(0.06, target * 0.035)) return target;
  }
  return null;
}

function inferBpmFromDuration(duration) {
  if (!duration || duration < 0.8 || duration > 60) return null;
  const hits = [];
  for (const bars of [1, 2, 4, 8, 16]) {
    const bpm = (bars * 4 * 60) / duration;
    const r = Math.round(bpm);
    if (r >= 90 && r <= 160 && Math.abs(bpm - r) < 0.35) hits.push({ bpm: r, bars });
  }
  if (!hits.length) return null;
  // Prefer the reading closest to a typical 120-135 tempo.
  hits.sort((a, b) => Math.abs(a.bpm - 128) - Math.abs(b.bpm - 128));
  return hits[0].bpm;
}

/* ------------------------------------------------------------------ *
 * Key / note
 * ------------------------------------------------------------------ */
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function normNote(letter, accidental) {
  let pc = PC[letter.toUpperCase()];
  if (accidental === '#' || accidental === 's') pc += 1;
  if (accidental === 'b') pc -= 1;
  return SHARP[((pc % 12) + 12) % 12];
}

function parseKey(name) {
  const base = name.replace(/\.[^.]+$/, '');
  // Strongest: a spelled-out scale word — Gmin, A_maj, Cminor. Letter
  // boundaries must exclude both cases, or "DMT" reads as D major.
  let m = /(?:^|[^A-Za-z0-9])([A-G])([#b])?\s*[_\- ]?\s*(minor|major|min|maj)(?![A-Za-z])/i.exec(base);
  if (m) {
    return {
      note: normNote(m[1], m[2] ? m[2].toLowerCase() : null),
      scale: /^(minor|min)$/i.test(m[3]) ? 'min' : 'maj',
      conf: 'high',
    };
  }
  // Single-letter scale suffix — F#m, Em, Am. Case matters here: m = minor.
  m = /(?:^|[^A-Za-z0-9])([A-G])([#b])?(m|M)(?![A-Za-z])/.exec(base);
  if (m) {
    return { note: normNote(m[1], m[2]), scale: m[3] === 'm' ? 'min' : 'maj', conf: 'high' };
  }
  // Note with accidental anywhere — "..._F#_..." is almost never a variant letter.
  m = /(?:^|[^A-Za-z0-9])([A-G])([#b])(?![A-Za-z0-9])/.exec(base);
  if (m) return { note: normNote(m[1], m[2]), scale: null, conf: 'high' };
  // Bare note directly after the tempo: "..._126bpm_C_-_Pack", "..._128_A_loop".
  m = /(?:\d{2,3}\s*bpm|\b\d{2,3})[_\- ]([A-G])(?![A-Za-z0-9#b])/i.exec(base);
  if (m) return { note: normNote(m[1], null), scale: null, conf: 'high' };
  // Note with an octave number: "G5", "F#3", "Db4".
  m = /(?:^|[^A-Za-z0-9])([A-G])([#b]?)([0-8])(?![0-9A-Za-z])/.exec(base);
  if (m) return { note: normNote(m[1], m[2]), scale: null, conf: 'high' };
  // Bare letter, but only at the very end of the name.
  m = /[_\- ]([A-G])$/.exec(base);
  if (m) return { note: normNote(m[1], null), scale: null, conf: 'low' };
  return null;
}

/* ------------------------------------------------------------------ *
 * Style / instrument category
 * ------------------------------------------------------------------ */
// Order matters: first match wins, so put specific before generic.
const STYLES = [
  ['Kick',        /\b(kick|kik|bd|bassdrum)\b/],
  ['Snare',       /\b(snare|snr|rimshot|rim)\b/],
  ['Clap',        /\b(clap|claps|snap|snaps)\b/],
  ['Hat',         /\b(hihat|hi-?hat|hats?|chh|ohh)\b/],
  ['Cymbal',      /\b(ride|crash|cymbal|splash|china)\b/],
  ['Tom',         /\b(toms?|conga|bongo|djembe|tabla)\b/],
  ['Percussion',  /\b(perc|percussion|percussions|shaker|tambourine|tamb|cowbell|clave|woodblock|cabasa|triangle)\b/],
  ['Drum Loop',   /\b(drum|drums|beat|break|breaks|groove|top|tops|rhythm)\b/],
  ['Bass',        /\b(bass|bassline|sub|808)\b/],
  ['Lead',        /\b(lead|leads|arp|arps|arpeggio|melody|melodic|riff|hook|topline)\b/],
  ['Chord',       /\b(chord|chords|stab|stabs|key|keys|piano|rhodes|organ)\b/],
  ['Pad',         /\b(pad|pads|drone|drones|string|strings)\b/],
  ['Atmosphere',  /\b(atmos|atmosphere|atmospheric|ambience|ambient|ambiance|texture|textures|soundscape|field)\b/],
  ['Vocal',       /\b(vocal|vocals|vox|vocs?|acapella|chant|chants|choir|spoken|phrase)\b/],
  ['Riser',       /\b(riser|risers|uplifter|build|sweep|sweeps|whoosh|transition)\b/],
  ['Impact',      /\b(impact|impacts|hit|hits|boom|slam|downlifter|downshifter)\b/],
  ['FX',          /\b(fx|sfx|effect|effects|glitch|noise|zap|blip|reverse|reversed)\b/],
  ['Foley',       /\b(foley|found|object|objects|mechanical|nature|water|wind|metal|wood)\b/],
  ['Synth',       /\b(synth|synths|seq|sequence|pluck|plucks|modular)\b/],
];

const GENRES = [
  ['Techno',      /\b(techno)\b/],
  ['Tech House',  /\b(tech[_\- ]?house)\b/],
  ['House',       /\b(house|deep[_\- ]?house|afro)\b/],
  ['Trance',      /\b(trance|psytrance|psy)\b/],
  ['DnB',         /\b(dnb|drum[_\- ]?(and|n|&)[_\- ]?bass|jungle|neurofunk|halftime|breakbeat)\b/],
  ['Dubstep',     /\b(dubstep|riddim|bass[_\- ]?music)\b/],
  ['Hip Hop',     /\b(hip[_\- ]?hop|trap|boom[_\- ]?bap|drill|rap)\b/],
  ['Ambient',     /\b(ambient|cinematic|drone|downtempo|chill|lofi|lo-?fi)\b/],
  ['Pop',         /\b(pop|rnb|r&b|indie|rock)\b/],
  ['Dub',         /\b(dub|reggae|dancehall|amapiano|afrobeat)\b/],
];

function detect(list, text, fallback) {
  for (const [label, re] of list) if (re.test(text)) return label;
  return fallback;
}

// Underscores/dashes/camelCase -> spaced lowercase words for regex matching.
function words(s) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/[_\-.#&()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleCase(s) {
  return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 * Per-file metadata
 * ------------------------------------------------------------------ */
function describe(fullPath, root) {
  const rel = path.relative(root, fullPath);
  const parts = rel.split(path.sep);
  const pack = titleCase(parts[0]);
  const file = parts[parts.length - 1];
  const stem = file.replace(/\.[^.]+$/, '');
  // Skip the pack folder and the redundant vendor folder when building context.
  const dirs = parts.slice(1, -1).join(' ');

  const header = path.extname(file).toLowerCase() === '.wav' ? readWavHeader(fullPath) : null;
  const duration = header ? header.duration : null;

  const nameWords = words(stem);
  const dirWords = words(dirs);
  const packWords = words(pack);
  const allWords = `${nameWords} ${dirWords} ${packWords}`;

  // --- format: loop vs one-shot -------------------------------------
  let format = null;
  if (/\b(one ?shots?|oneshot|hits?|single ?hits?|stabs?)\b/.test(`${nameWords} ${dirWords}`)) format = 'One-shot';
  if (/\b(loops?|loopz)\b/.test(`${nameWords} ${dirWords}`)) format = 'Loop';
  if (!format && duration != null) format = duration >= 1.6 ? 'Loop' : 'One-shot';
  if (!format) format = 'One-shot';

  // --- style / genre ------------------------------------------------
  let style = detect(STYLES, nameWords, null);
  if (!style) style = detect(STYLES, dirWords, null);
  if (!style) style = detect(STYLES, packWords, 'Other');
  const genre = detect(GENRES, `${packWords} ${dirWords} ${nameWords}`, null);

  // --- bpm ----------------------------------------------------------
  let bpm = null;
  let bpmSource = null;
  const cands = [...bpmCandidates(stem), ...bpmCandidates(dirs).map((c) => ({ ...c, score: c.score - 12 }))];
  if (cands.length) {
    for (const c of cands) if (barFit(duration, c.bpm)) c.score += 40;
    cands.sort((a, b) => b.score - a.score);
    if (cands[0].score >= 45) {
      bpm = cands[0].bpm;
      bpmSource = cands[0].score >= 100 ? 'name' : 'name';
    }
  }
  const RHYTHMIC = /^(Kick|Snare|Clap|Hat|Cymbal|Tom|Percussion|Drum Loop|Bass|Lead|Chord|Synth)$/;
  if (bpm == null && format === 'Loop' && RHYTHMIC.test(style || '')) {
    const guess = inferBpmFromDuration(duration);
    if (guess) { bpm = guess; bpmSource = 'inferred'; }
  }

  // --- key ----------------------------------------------------------
  let key = parseKey(file);
  if (!key) {
    const dk = parseKey(parts[parts.length - 2] || '');
    if (dk && dk.conf === 'high') key = dk;
  }
  // A bare trailing letter on a drum hit is a variant label, not a key.
  if (key && key.conf === 'low' && /\b(kick|snare|clap|hat|perc|drum|tom|ride|crash|fx|foley)\b/.test(allWords)) {
    key = null;
  }

  return {
    path: fullPath,
    rel,
    name: stem.replace(/[_]+/g, ' ').trim(),
    file,
    pack,
    folder: parts.slice(1, -1).map(titleCase).join(' / '),
    bpm,
    bpmSource,
    note: key ? key.note : null,
    scale: key ? key.scale : null,
    style,
    genre,
    format,
    duration: duration != null ? Math.round(duration * 1000) / 1000 : null,
    sampleRate: header ? header.sampleRate : null,
    channels: header ? header.channels : null,
    bits: header ? header.bits : null,
    size: (() => { try { return fs.statSync(fullPath).size; } catch { return null; } })(),
  };
}

/* ------------------------------------------------------------------ *
 * Walk
 * ------------------------------------------------------------------ */
function walk(dir, out, onProgress) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, onProgress);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
      if (onProgress && out.length % 250 === 0) onProgress(out.length);
    }
  }
}

function scan(root, onProgress) {
  const files = [];
  walk(root, files, onProgress);
  files.sort();
  const samples = files.map((f, i) => {
    if (onProgress && i % 250 === 0) onProgress(i, files.length);
    return describe(f, root);
  });
  return { root, scannedAt: Date.now(), samples };
}

module.exports = { scan, describe, readWavHeader, parseKey, bpmCandidates };
