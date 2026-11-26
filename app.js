// StrumAlong — a play-along app for the AeroBand guitar (see README.md and docs/).
// Listens to the guitar's Bluetooth/USB MIDI, works out which chord each strum was and when,
// lights the frets, plays the sound, and shows the song, the fret to press and timing feedback.
'use strict';
const APP_VERSION = '1.7.0';   // bump this for every release, and add a line to CHANGELOG.md

// ---------- constants ----------
const FRET_COLORS = { 1:'#34c759', 2:'#2f6fe0', 3:'#e5443b', 4:'#9b59e0', 5:'#62cdf5', 6:'#f5d33d', 7:'#f26fb4' };
const FRET_NAMES  = { 1:'green', 2:'blue', 3:'red', 4:'purple', 5:'light blue', 6:'yellow', 7:'pink' };
const STRUM_GAP_MS = 120;     // a strum ends this long after its last string
const MIN_STRUM_NOTES = 2;    // 2+ strings = a strum (partial strums count)
const REFRACTORY_MS = 220;    // notes this soon after a strum began belong to that strum
const MAC_DECIDE_MS = 25;     // Mac sound: wait this long to see a few strings, then play
const ON_TIME_MS = 90;        // |error| within this = on time (fixed mode)
const SAMPLE_URLS = [
  'sounds/acoustic_guitar_steel-mp3.js',   // local copy, if present
  'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_steel-mp3.js',
  'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/acoustic_guitar_steel-mp3.js',
];
const FLATS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
// Standard open-position voicings, low E string → high E string (null = string not played)
const VOICINGS = {
  C:[null,48,52,55,60,64], D:[null,null,50,57,62,66], Dm:[null,null,50,57,62,65], E:[40,47,52,56,59,64],
  Em:[40,47,52,55,59,64], F:[41,48,53,57,60,65], G:[43,47,50,55,59,67], A:[null,45,52,57,61,64],
  Am:[null,45,52,57,60,64], Bdim:[null,47,53,59,62,null], B7:[null,47,51,57,59,66], A7:[null,45,52,55,61,64],
  D7:[null,null,50,57,60,66], E7:[40,47,50,56,59,64], G7:[43,47,50,55,59,65], C7:[null,48,52,58,60,64],
};
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const ROOTS = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
const QUALITIES = { '':[0,4,7], m:[0,3,7], dim:[0,3,6], aug:[0,4,8], '7':[0,4,7,10], m7:[0,3,7,10], maj7:[0,4,7,11],
  sus2:[0,2,7], sus4:[0,5,7], m7b5:[0,3,6,10], '6':[0,4,7,9], m6:[0,3,7,9] };

// ---------- small helpers ----------
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('ab.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ab.' + k, JSON.stringify(v)); } catch {} },
};
function chordPCs(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name || '');
  if (!m || !(m[1] in ROOTS)) return null;
  const q = QUALITIES[m[2]] ?? QUALITIES[m[2].replace('min', 'm')];
  if (!q) return null;
  return { root: ROOTS[m[1]], pcs: q.map(i => (ROOTS[m[1]] + i) % 12) };
}
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);

// ---------- state ----------
const S = {
  song: null, slots: [], songs: [],
  mode: store.get('mode', 'follow'),
  tempo: store.get('tempo', 50),
  spb: [2, 4].includes(store.get('spb', 2)) ? store.get('spb', 2) : 2,
  melodyOn: store.get('melody', true), melody: [], melNext: 0,
  vocalsOn: store.get('vocals', true),          // play the song's recorded singer (song.vocal) in Listen / Fixed tempo
  voiceLevel: store.get('voiceLevel', 0.5),     // the singer's loudness relative to the guitar (Voice slider)
  band: store.get('band', 'auto'),               // Jam with the band: auto (the song's style) / folk / country / rock / off
  bandLevel: store.get('bandLevel', 0.7),        // the band's loudness (Band slider)
  click: store.get('click', true),
  backing: store.get('backing', false),          // Fixed tempo: the Mac strums the chords along with you
  strumLevel: store.get('strumLevel', 'easy'),   // easy / medium / full strum pattern
  strumStyle: store.get('strumStyle', 'plain'),  // Computer sound: plain / boom (boom-chuck) / pick (fingerpick) / arp (arpeggio)
  fretLayout: store.get('fretLayout', 'song'),   // 'song' = only the song's chords; 'key' = all 7 chords of the key
  volume: store.get('volume', 2.2),     // Mac sound level (1 = old level)
  verse: store.get('verse', 'all'),
  sound: store.get('sound', 'mac'),   // first-time default: computer sound. 'guitar' = guitar speaker; 'mac' = perfect strum from the computer
  samples: null, samplesState: 'none', voices: [],
  playing: false, t0: 0, pos: 0, shownPos: 0,
  countInUntil: 0,
  marks: [],            // drawn strum ticks: {t, x?}
  last: null,           // last strum summary
  okTimes: [],          // follow-mode successful strum times (for pace)
  stats: null,
  audio: null, nextBeat: 0,
};

// ---------- song model ----------
function chordFret(chord) {
  const ec = S.song?.easyChord || {};
  for (const [fret, c] of Object.entries(ec)) if (c === chord) return +fret;
  return null;
}
function chordColor(chord) { const f = chordFret(chord); return f ? FRET_COLORS[f] : '#777'; }

// Song lines are lists of cells [chord, words]; each cell is song.cellBeats long
// (2 = half a bar), so chords can change mid-bar. "{A}" etc. come from the verse.
function parseNote(n) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n || ''); if (!m || !(m[1] in ROOTS)) return null;
  return ROOTS[m[1]] + 12 * (+m[2] + 1);
}
function fillWords(w, verse) { return (w || '').replace(/\{(\w+)\}/g, (_, k) => verse[k] ?? ''); }
function buildSlots() {
  const song = S.song, out = [], mel = [];
  const bpb = song.beatsPerBar || 4, cb = song.cellBeats || 2;
  // strumsPerCell [few, many] lets waltzes (3/4) strum 1 or 3 times a bar instead of an even split.
  const perCell = Array.isArray(song.strumsPerCell) ? song.strumsPerCell[S.spb === 4 ? 1 : 0]
                : Math.max(1, Math.round(S.spb * cb / bpb)), step = cb / perCell;
  const verses = song.verses.map((v, i) => i).filter(i => S.verse === 'all' || String(i) === String(S.verse));
  let beat = 0;
  const segs = [];
  verses.forEach(vi => {
    const verse = song.verses[vi], vStart = beat;
    segs.push({ vi, vStart });
    song.lines.forEach((cells, li) => cells.forEach(([chord, w], ci) => {
      const word = fillWords(w, verse);
      for (let k = 0; k < perCell; k++) {
        out.push({ chord, verse: vi, line: li, cell: ci, firstOfCell: k === 0,
                   firstOfBar: k === 0 && Math.abs((beat % bpb)) < 1e-6, beatInBar: Math.round(beat % bpb),
                   word: k === 0 ? word : '', beat, res: null, err: null, heard: null });
        beat += step;
      }
    }));
    if (Array.isArray(song.melody)) {
      let t = vStart + (song.melodyStart || 0);
      for (const [n, d] of song.melody) { const midi = parseNote(n); if (midi != null) mel.push({ beat: t, midi, dur: d }); t += d; }
    }
  });
  S.slots = out; S.melody = mel; S.melNext = 0; S.slotBeats = step;
  // Where each verse lives in the song's vocal recording (all verses back to back, each starting at its pickup).
  const vb = song.lines.reduce((a, l) => a + l.length * cb, 0), vs = song.vocal?.start ?? (song.melodyStart || 0);
  S.voxSegs = segs.map((g, i) => ({ a: g.vStart + vs, b: i < segs.length - 1 ? segs[i + 1].vStart + vs : Infinity,
                                     off: g.vi * (song.vocal?.verseBeats || vb) }));
}
function resetRun() {
  buildSlots();
  S.freeLog = [];
  S.playing = false; S.demo = false; S.pos = 0; S.shownPos = 0; S.t0 = 0; S.marks = []; S.last = null; S.okTimes = [];
  S.stats = { ok:0, early:0, late:0, wrong:0, miss:0, errSum:0, errN:0, tries:0 };
  $('start').textContent = 'Start'; $('listen').textContent = '▶ Listen';
  hideMsg();
  renderAll();
}

// ---------- timing (fixed mode) ----------
const beatMs = () => 60000 / S.tempo;
// Time between strum slots = the song's actual beats per slot (waltzes aren't an even split of the bar).
const slotMs = () => beatMs() * (S.slotBeats || (S.song?.beatsPerBar || 4) / S.spb);
function fixedPos(t = performance.now()) { return (t - S.t0) / slotMs(); }
function currentIndex() {
  if (S.mode === 'follow' && !S.demo) return Math.min(S.pos, S.slots.length - 1);
  if (!S.playing) return 0;
  return Math.max(0, Math.min(S.slots.length - 1, Math.round(fixedPos())));
}

// ---------- chord recognition ----------
function identifyChord(notes) {
  const counts = new Array(12).fill(0);
  notes.forEach(n => counts[n % 12]++);
  const lowest = Math.min(...notes) % 12;
  const pool = new Set([...Object.values(S.song?.easyChord || {}), ...S.slots.map(s => s.chord)]);
  let best = null, bestScore = -1e9;
  for (const name of pool) {
    const c = chordPCs(name); if (!c) continue;
    let inside = 0, outside = 0;
    counts.forEach((n, pc) => { if (c.pcs.includes(pc)) inside += n; else outside += n; });
    const missing = c.pcs.filter(pc => !counts[pc]).length;
    const score = inside - 1.5 * outside - 0.6 * missing + (lowest === c.root ? 0.5 : 0) + (counts[c.root] ? 0.3 : 0);
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best;
}

// Natural mode: name ANY chord from the notes (all 12 roots, common chord types). Fewer than 3
// different notes is not a chord (null).
const ANY_QUALITIES = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'dim', 'aug', '6', 'm6', 'm7b5'];
function identifyAny(notes) {
  const counts = new Array(12).fill(0); notes.forEach(n => counts[n % 12]++);
  if (counts.filter(Boolean).length < 3) return null;
  const lowest = Math.min(...notes) % 12;
  let best = null, bestScore = -1e9;
  for (let r = 0; r < 12; r++) for (const q of ANY_QUALITIES) {
    const pcs = QUALITIES[q].map(i => (r + i) % 12);
    let inside = 0, outside = 0;
    counts.forEach((n, pc) => { if (pcs.includes(pc)) inside += n; else outside += n; });
    const missing = pcs.filter(pc => !counts[pc]).length;
    const score = inside - 2 * outside - 0.8 * missing + (lowest === r ? 0.6 : 0) - (pcs.length > 3 ? 0.15 : 0);
    if (score > bestScore) { bestScore = score; best = NAMES[r] + q; }
  }
  return bestScore > 0 ? best : null;
}
// The chord the song wants right now (used to be forgiving with partial strums).
function wantedChord(t = performance.now()) {
  if (!S.slots.length || S.mode === 'free') return null;
  if (S.mode === 'follow') return S.slots[Math.min(S.pos, S.slots.length - 1)].chord;
  if (!S.playing) return S.slots[0].chord;
  const k = Math.max(0, Math.min(S.slots.length - 1, Math.round(fixedPos(t))));
  return S.slots[k].chord;
}
// Forgiving chord judgement: if every note you hit belongs to the wanted chord,
// it IS the wanted chord (a 2-string or half strum still counts).
// Mac mode with Bluetooth: the chord is whatever Easy Chord fret you are holding.
// If you hold the wanted chord's fret on any string, it counts.
function heldChord(want) {
  const frets = Object.values(L.held || {});
  if (!frets.length || !S.song) return null;
  const ec = S.song.easyChord || {}, wf = chordFret(want);
  if (wf && frets.includes(wf)) return want;
  const count = {}; frets.forEach(f => count[f] = (count[f] || 0) + 1);
  const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  return ec[best] || null;
}
function judgeChord(notes, want) {
  if (S.sound === 'finger') return identifyAny(notes);   // Natural: the real chord your fingers made
  if ((S.sound === 'mac' || S.sound === 'silent' || S.mode === 'free') && S.sound !== 'finger') { const hc = heldChord(want); if (hc) return hc; }
  const w = chordPCs(want);
  if (w) {
    const outside = notes.filter(n => !w.pcs.includes(n % 12)).length;
    if (outside === 0 || (notes.length >= 4 && outside === 1)) return want;
  }
  return identifyChord(notes);
}
// Mac mode is most forgiving: any single string on the right fret counts as a strum.
// One string = you're picking a note, not strumming, so it never counts as a strum (it doesn't move the song).
function minStrumNotes() { return MIN_STRUM_NOTES; }
function strumDir(notes) {
  let up = 0, down = 0;
  for (let i = 1; i < notes.length; i++) { if (notes[i] > notes[i - 1]) down++; else if (notes[i] < notes[i - 1]) up++; }
  return down >= up ? 'down' : 'up';
}

// ---------- strum assembly from MIDI ----------
let pending = null, pendingTimer = null, lastStrumT = -1e9, lastWasPick = false;
window.STRUMS = [];   // recent strums, for debugging
const NATURAL_MIN_VEL = store.get('naturalMinVel', 10);   // 20% more sensitive than the measured 13
window.NOTES = [];   // recent single notes with loudness, for tuning the Natural-mode touch threshold
function onNote(note, vel, t, ch = -1) {
  NOTES.push({ t: Math.round(t), note, vel, ch }); if (NOTES.length > 400) NOTES.shift();
  // Natural mode: ignore accidental brushes. Measured 23 Nov 2026: accidents 2–12, real plucks 14–48.
  if (S.sound === 'finger' && vel < NATURAL_MIN_VEL) return;
  if (S.sound === 'finger') {   // Natural mode: every string sounds as played; remember it for the string display
    playFinger(note, vel, ch);
    (S.strings ||= {})[ch >= 0 ? ch : note % 6] = { note, t: performance.now() };
    lastKey = '';
  }
  if (!pending) {
    if (t - lastStrumT < REFRACTORY_MS && !lastWasPick) return;     // tail end of the previous strum (not after a single pick)
    pending = { t, notes: [], vels: [], want: wantedChord(t) };
    lastStrumT = t;
    if (S.sound === 'mac') { const p = pending; setTimeout(() => macPlay(p), MAC_DECIDE_MS); }
  }
  pending.notes.push(note); pending.vels.push(vel);
  // Decided it was a single pick, but more strings came after all: it's a (slow) strum — strum it.
  if (pending.picked && !pending.macChord && pending.notes.length >= MIN_STRUM_NOTES) { pending.picked = false; macPlay(pending); }
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(finishStrum, STRUM_GAP_MS);
}
function finishStrum() {
  const p = pending; pending = null;
  if (!p) return;
  lastWasPick = p.notes.length < MIN_STRUM_NOTES;
  window.STRUMS.push({ t: Math.round(p.t), notes: p.notes.map(noteName).join(' '), n: p.notes.length });
  if (window.STRUMS.length > 60) window.STRUMS.shift();
  // Natural + Free play: a single pick shows its note.
  if (p.notes.length === 1 && S.sound === 'finger' && S.mode === 'free') {
    const nm = noteName(p.notes[0]);
    S.last = { t: p.t, chord: nm, pick: true, notes: p.notes, dir: 'down', vel: p.vels[0], res: 'free' };
    (S.freeLog ||= []).push({ t: performance.now(), chord: nm }); if (S.freeLog.length > 60) S.freeLog.shift();
    renderAll(); return;
  }
  if (p.notes.length < minStrumNotes()) return;
  const vel = Math.round(p.vels.reduce((a, b) => a + b, 0) / p.vels.length);
  onStrum({ t: p.t, chord: p.macChord || judgeChord(p.notes, p.want), dir: p.macDir || strumDir(p.notes), vel, notes: p.notes });
}

// ---------- Mac sound: a clean, even strum of the chord you meant ----------
function macPlay(p) {
  if (S.sound !== 'mac' || !p.notes.length) return;
  if (p.notes.length < MIN_STRUM_NOTES && pending === p) {
    // only one string so far — give it a few more ms, then play anyway if more arrive
    if (!p.waited) { p.waited = true; setTimeout(() => macPlay(p), MAC_DECIDE_MS); return; }
    // Still one string: you're picking. Play just that note.
    p.picked = true; playPick(p.notes[0], p.vels[0]); return;
  }
  const chord = judgeChord(p.notes, p.want);
  const dir = p.notes.length >= 2 ? strumDir(p.notes) : 'down';
  const vel = p.vels.reduce((a, b) => a + b, 0) / p.vels.length;
  p.macChord = chord; p.macDir = dir;
  playStyled(chord, dir, vel, p.t);
}
function strumChord(chord, dir, vel, when, top = 0) {
  if (!S.samples || !S.audio) return;
  let v = VOICINGS[chord] || voicing(chord);
  let strings = v.map((n, s) => ({ n, s })).filter(x => x.n != null);
  if (top) strings = strings.slice(-top);
  if (dir === 'up') strings = strings.slice(-4).reverse();     // up-strums catch the top strings
  const spread = dir === 'up' ? 0.011 : 0.014;
  // Even, musical loudness: mostly fixed, a little of your dynamics kept.
  const level = (0.55 + 0.3 * Math.min(1, vel / 100)) * (dir === 'up' ? 0.8 : 1);
  const t0 = when ?? (S.audio.currentTime + 0.005);
  strings.forEach((x, i) => playNote(x.s, x.n, t0 + i * spread, level * (0.92 + 0.08 * Math.random())));
}
// ---------- Strum styles (Computer sound): you strum once, the computer plays a pattern over the block ----------
// The first note sounds straight away (so it still feels instant); the rest follows in time until the
// next block. Your next strum cuts off whatever is left. Up-strum = a bass walk into the next chord.
// Loudness follows how hard you strummed.
const STYLE_TICK_MS = 20, STYLE_AHEAD_MS = 60;
function bassPair(chord) {
  const v = VOICINGS[chord] || voicing(chord), pc = chordPCs(chord);
  const low = v.slice(0, 4).map((n, i) => ({ n, i })).filter(x => x.n != null);
  if (!low.length) return { root: null, alt: null };
  const r = (pc && low.find(x => x.n % 12 === pc.root)) || low[0];
  const fifth = pc && low.find(x => x.i < 3 && x.n !== r.n && x.n % 12 === (pc.root + 7) % 12);
  const next = low.find(x => x.i > r.i);
  return { root: r.n, alt: (fifth || next || r).n };
}
function trebleNotes(chord) {
  const v = VOICINGS[chord] || voicing(chord);
  return v.map((n, i) => ({ n, i })).filter(x => x.n != null).slice(-3);   // the top three strings that sound
}
function songScale() {   // every note used by the song's chords ≈ its scale
  const set = new Set();
  for (const sl of S.slots) { const c = chordPCs(sl.chord); if (c) c.pcs.forEach(x => set.add(x)); }
  return set;
}
function nextChordFor(t) {
  if (!S.playing || !S.slots.length) return null;
  const i = S.mode === 'fixed' ? Math.round(fixedPos(t)) : S.mode === 'follow' ? S.pos : -1;
  return i >= 0 ? S.slots[i + 1]?.chord || null : null;
}
function bassWalk(fromChord, toChord) {   // e.g. G → C : A, B (then the next strum lands on C)
  const a = bassPair(fromChord).root, b0 = bassPair(toChord).root;
  if (a == null || b0 == null || fromChord === toChord) return [];
  let b = b0; while (b - a > 6) b -= 12; while (a - b > 6) b += 12;
  const scale = songScale(), step = b > a ? 1 : -1, out = [];
  for (let n = a + step; n !== b; n += step) if (scale.has(((n % 12) + 12) % 12)) out.push(n);
  return out.slice(-2);
}
function blockMs(t) {
  if (S.mode === 'fixed' && S.playing) return slotMs();
  // Follow me / Free play: no clock, so follow your own pace (recent gaps between strums).
  const h = (S.styleTimes ||= []); h.push(t); if (h.length > 4) h.shift();
  const gaps = h.slice(1).map((x, i) => x - h[i]).filter(g => g > 250 && g < 4000).sort((x, y) => x - y);
  const pace = gaps.length ? gaps[Math.floor(gaps.length / 2)] : slotMs();
  return Math.max(450, Math.min(3000, pace));
}
function stylePlan(chord, dir, vel, t) {
  const st = S.strumStyle, T = blockMs(t);
  const beats = S.slotBeats || (S.song?.beatsPerBar || 4) / S.spb, bpb = S.song?.beatsPerBar || 4;
  // Note grid: eighths, doubled (to sixteenths) when the song is slow, so picking keeps flowing.
  const base = Math.max(2, Math.round(beats * 2)); let mul = 1;
  while (T / (base * mul) > 380 && mul < 4) mul *= 2;
  const E = base * mul, e8 = T / E;
  const f = 0.7 + 0.45 * Math.min(1, vel / 100);              // how hard you strummed
  const { root, alt } = bassPair(chord), tre = trebleNotes(chord);
  const flip = (S.styleFlip = !S.styleFlip);                  // alternate bass from block to block
  const ev = [];   // { k: eighth, fn(at) }
  const note = (k, key, n, lvl) => n != null && ev.push({ k, fn: at => playNote(key, n, at, lvl * f) });
  if (st === 'boom') {
    if (beats < 2) { note(0, 'bass', flip ? root : alt, 0.7); ev.push({ k: (base >= 3 ? 2 : 1) * mul, fn: at => strumChord(chord, 'down', vel * 0.8, at, 4) }); }
    else for (let j = 0; j < beats; j++) {
      const bassBeat = bpb === 3 ? j % 3 === 0 : j % 2 === 0;
      if (bassBeat) note(j * 2 * mul, 'bass', (j % 4 === 0) === flip ? root : alt, 0.75);
      else ev.push({ k: j * 2 * mul, fn: at => strumChord(chord, 'down', vel * 0.8, at, 4) });
    }
  } else if (st === 'pick') {
    for (let k = 0; k < E; k++) {
      const j = k >> 1;
      if (k % 2 === 0) {
        note(k, 'thumb', (j % 2 === 0) === flip ? root : alt, 0.72);
        if (k === 0 && tre[2]) note(k, 'f' + tre[2].i, tre[2].n, 0.55);   // pinch: thumb + top string together
      } else { const x = tre[j % 2 === 0 ? 1 : 0] || tre[0]; if (x) note(k, 'f' + x.i, x.n, 0.5); }
    }
  } else if (st === 'arp') {
    const v = VOICINGS[chord] || voicing(chord);
    const ri = v.findIndex(n => n === root);
    const up = v.map((n, i) => ({ n, i })).filter(x => x.n != null && x.i >= Math.max(0, ri));
    const seq = up.concat(up.slice(1, -1).reverse());
    for (let k = 0; k < E; k++) { const x = seq[k % seq.length]; note(k, 'a' + x.i, x.n, k === 0 ? 0.75 : 0.58); }
  }
  // Up-strum: walk the bass into the next chord over the last eighths of the block.
  if (dir === 'up') {
    const walk = bassWalk(chord, nextChordFor(t));
    if (walk.length) {
      const from = E - walk.length;
      for (let i = ev.length - 1; i >= 0; i--) if (ev[i].k >= from && ev[i].k > 0) ev.splice(i, 1);
      walk.forEach((n, i) => note(from + i, 'bass', n, 0.75));
    }
  }
  return ev.map(x => ({ t: performance.now() + x.k * e8, fn: x.fn }));
}
function playStyled(chord, dir, vel, t) {
  if (S.strumStyle === 'plain' || !S.samples || !S.audio) { strumChord(chord, dir, vel); return; }
  const ev = stylePlan(chord, dir, vel, t);
  S.stylePat = ev;              // replaces (cuts off) whatever was left of the last pattern
  styleTick();
  if (!S.styleTimer) S.styleTimer = setInterval(styleTick, STYLE_TICK_MS);
}
function styleTick() {
  const ev = S.stylePat; if (!ev || !S.audio) return;
  const now = performance.now();
  while (ev.length && ev[0].t < now + STYLE_AHEAD_MS) {
    const e = ev.shift();
    e.fn(S.audio.currentTime + Math.max(0.003, (e.t - now) / 1000));
  }
}
// Finger mode: like a real guitar — play exactly the note each string reports, right away;
// a new note on a string cuts off that string's previous note.
function playFinger(midi, vel, ch) {
  if (!S.samples || !S.audio) { loadSamples(); return; }
  playNote('s' + (ch >= 0 ? ch : midi), midi, S.audio.currentTime + 0.002, 0.45 + 0.45 * Math.min(1, vel / 110));
}
function playPick(midi, vel) {
  if (!S.samples || !S.audio) return;
  playNote('pick' + midi, midi, S.audio.currentTime + 0.003, 0.6 + 0.35 * Math.min(1, vel / 100));
}
function playNote(string, midi, at, level) {
  const smp = nearestSample(midi); if (!smp) return;
  const old = S.voices[string];
  if (old) { try { old.g.gain.setTargetAtTime(0, at, 0.02); old.src.stop(at + 0.15); } catch {} }
  const src = S.audio.createBufferSource(), g = S.audio.createGain();
  src.buffer = smp.buf; src.playbackRate.value = Math.pow(2, (midi - smp.midi) / 12);
  g.gain.setValueAtTime(level, at);
  src.connect(g).connect(S.master); src.start(at);
  S.voices[string] = { src, g };
}
function nearestSample(midi) {
  if (!S.samples) return null;
  for (let d = 0; d <= 3; d++) for (const m of [midi - d, midi + d]) if (S.samples[m]) return { midi: m, buf: S.samples[m] };
  return null;
}
async function loadSamples() {
  if (S.samplesState === 'loading' || S.samplesState === 'ready') return;
  ensureAudio(); if (!S.audio) return;
  S.samplesState = 'loading'; renderSide();
  if (!S.master) {
    const comp = S.audio.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    // Limiter after the volume, so turning it up gets louder without crackling.
    const lim = S.audio.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1;
    S.master = S.audio.createGain(); S.master.gain.value = 1;
    S.vol = S.audio.createGain(); S.vol.gain.value = S.volume;
    S.master.connect(comp).connect(S.vol).connect(lim).connect(S.audio.destination);
  }
  let text = null;
  for (const u of SAMPLE_URLS) { try { const r = await fetch(u); if (r.ok) { text = await r.text(); break; } } catch {} }
  if (!text) { S.samplesState = 'failed'; renderSide(); return; }
  const re = /"([A-G]b?)(\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g, out = {}, jobs = [];
  let m;
  while ((m = re.exec(text))) {
    const midi = FLATS.indexOf(m[1]) + 12 * (+m[2] + 1);
    if (midi < 36 || midi > 84) continue;
    const b64 = m[3];
    jobs.push((async () => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try { out[midi] = await S.audio.decodeAudioData(bytes.buffer); } catch {}
    })());
  }
  await Promise.all(jobs);
  S.samples = out;
  S.samplesState = Object.keys(out).length ? 'ready' : 'failed';
  renderSide();
}

function onStrum(s) {
  if (!S.song || S.demo) return;
  // Free play: no song to follow — just show (and light) what you played.
  if (S.mode === 'free') {
    S.last = { ...s, res: 'free' };
    (S.freeLog ||= []).push({ t: performance.now(), chord: s.chord });
    if (S.freeLog.length > 60) S.freeLog.shift();
    renderAll(); return;
  }
  // A strum in Follow mode starts the song if it isn't running.
  if (!S.playing && S.mode === 'follow') start();
  if (!S.playing) { S.last = { ...s, res: 'idle' }; renderSide(); return; }
  if (S.mode === 'fixed' && s.t < S.countInUntil) { S.last = { ...s, res: 'countin' }; renderSide(); return; }
  S.stats.tries++;

  if (S.mode === 'follow') {
    const slot = S.slots[S.pos];
    if (!slot) return;
    if (s.chord === slot.chord) {
      slot.res = 'ok'; slot.heard = s.chord; slot.heardDir = s.dir; S.stats.ok++;
      bandStrum(slot);
      S.lastOk = { t: performance.now(), chord: s.chord };   // for the blink-to-repeat light
      S.okTimes.push(s.t); if (S.okTimes.length > 6) S.okTimes.shift();
      S.pos++;
      S.last = { ...s, res: 'ok' };
      if (S.pos >= S.slots.length) finish();
    } else {
      S.stats.wrong++;
      S.last = { ...s, res: 'wrong', want: slot.chord };
    }
  } else {
    const fp = fixedPos(s.t), k = Math.round(fp);
    S.marks.push({ pos: fp, chord: s.chord });
    if (S.marks.length > 40) S.marks.shift();
    const slot = S.slots[k];
    if (!slot || slot.res) { S.last = { ...s, res: 'extra' }; renderSide(); return; }
    const err = (fp - k) * slotMs();
    slot.err = err; slot.heard = s.chord; slot.heardDir = s.dir;
    if (s.chord !== slot.chord) { slot.res = 'wrong'; S.stats.wrong++; }
    else if (Math.abs(err) <= ON_TIME_MS) { slot.res = 'ok'; S.stats.ok++; }
    else if (err < 0) { slot.res = 'early'; S.stats.early++; }
    else { slot.res = 'late'; S.stats.late++; }
    if (slot.chord === s.chord) S.lastOk = { t: performance.now(), chord: s.chord };
    if (slot.chord === s.chord) { S.stats.errSum += Math.abs(err); S.stats.errN++; }
    S.last = { ...s, res: slot.res, err, want: slot.chord };
  }
  renderAll();
}

// ---------- transport ----------
function ensureAudio() {
  const fresh = !S.audio;
  if (!S.audio) { try { S.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (S.audio && S.audio.state === 'suspended') S.audio.resume();
  if (fresh && S.audio) pinSpeakers(true);
}
// ---------- where our sound goes ----------
// The guitar is also a Bluetooth speaker, and when it powers on the computer may switch its sound output
// to the guitar, so the clean strum would come out of the guitar (or get lost). Rule:
//   - computer's output is the guitar  -> send our sound to the built-in speakers instead
//   - anything else (speakers, headphones, AirPods, external) -> follow the computer's own choice
// Re-checked whenever outputs change. Chrome only reveals device names after microphone permission,
// so we ask once (nothing is recorded); without names we simply follow the computer.
const SPEAKER_RE = /macbook|built-?in|internal|realtek|^speakers/i;   // Mac and typical Windows laptop speakers
const cleanName = l => (l || '').replace(/^(default|communications)\s*-\s*/i, '').replace(/\s*\(.*\)$/, '');
async function pinSpeakers(askIfNeeded = false) {
  if (!S.audio || !S.audio.setSinkId || !navigator.mediaDevices?.enumerateDevices) return;
  const outputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
  let outs = await outputs();
  if (askIfNeeded && !outs.some(d => d.label)) {
    try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop()); } catch {}
    outs = await outputs();
  }
  const def = outs.find(d => d.deviceId === 'default');
  const defName = cleanName(def?.label);
  try {
    if (/aero/i.test(defName)) {
      const builtIn = outs.find(d => d.deviceId !== 'default' && SPEAKER_RE.test(d.label) && !/aero/i.test(d.label));
      if (builtIn) {
        if (S.audio.sinkId !== builtIn.deviceId) await S.audio.setSinkId(builtIn.deviceId);
        S.speaker = cleanName(builtIn.label);
      } else S.speaker = null;
    } else {
      if (S.audio.sinkId !== '') await S.audio.setSinkId('');   // follow the computer's own output
      S.speaker = defName || null;
    }
  } catch { S.speaker = null; }
  renderSound();
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => pinSpeakers());
function start() {
  if (!S.song) return;
  if (S.demo || S.pos >= S.slots.length || S.slots.every(x => x.res)) resetRun();
  ensureAudio();
  S.playing = true;
  $('start').textContent = 'Stop';
  if (S.mode === 'fixed') anchorClock();
  renderAll();
}
// Start the song clock after a one-bar count-in.
function anchorClock() {
  const bpb = S.song.beatsPerBar || 4, now = performance.now();
  S.countInUntil = now + bpb * beatMs();
  S.t0 = S.countInUntil;
  S.nextBeat = -bpb;   // beat numbers relative to t0; negatives are the count-in
  S.melNext = 0; S.demoTick = 0; S.bandTick = 0;
  if (bandOn()) { loadSamples(); loadBass(); }
  if (S.backing && S.mode === 'fixed') loadSamples();
  if (S.melodyOn || voxOn()) loadSamples();
}
// Listen: the Mac plays the whole song at the tempo slider's speed.
async function listen() {
  if (!S.song) return;
  if (S.demo && S.playing) { stop(); return; }
  resetRun();
  await loadSamples();
  if (S.samplesState !== 'ready') { showMsg('No guitar sound', 1500); return; }
  S.demo = true; S.playing = true; S.demoTick = 0;
  anchorClock();
  $('listen').textContent = '■ Stop listening';
  renderAll();
}
function stop() {
  S.playing = false; S.demo = false;
  $('start').textContent = 'Start'; $('listen').textContent = '▶ Listen'; hideMsg(); renderAll();
}
function finish() {
  const wasDemo = S.demo;
  S.playing = false; S.demo = false;
  $('start').textContent = 'Start'; $('listen').textContent = '▶ Listen';
  showMsg(wasDemo ? 'Your turn' : 'Done', 2500);
  renderAll();
}
// True while a song clock is running (Fixed tempo, or Listen).
function timed() { return S.playing && (S.mode === 'fixed' || S.demo); }
function setTempo(v) {
  const keep = timed() ? fixedPos() : null;
  S.tempo = v; store.set('tempo', v);
  if (keep != null) {
    const now = performance.now();
    S.t0 = now - keep * slotMs();
    S.countInUntil = Math.min(S.countInUntil, now);
    S.nextBeat = Math.floor((now - S.t0) / beatMs()) + 1;
    if (backingOn()) S.demoTick = Math.max(S.demoTick || 0, Math.ceil(keep * (S.slotBeats || 1) * 2));
    if (bandOn()) S.bandTick = Math.max(S.bandTick || 0, Math.ceil(keep * (S.slotBeats || 1) * 2));
    const mi = S.melody.findIndex(m => S.t0 + m.beat * beatMs() >= now);
    S.melNext = mi < 0 ? S.melody.length : mi;
  }
  renderControls();
}
function scheduleMelody() {
  if (voxOn()) return;   // the singer carries the tune
  if (!S.melodyOn || !S.audio || !S.samples || !timed() || !S.melody.length) return;
  const now = performance.now(), bm = beatMs();
  while (S.melNext < S.melody.length && S.t0 + S.melody[S.melNext].beat * bm < now + 120) {
    const m = S.melody[S.melNext++], tm = S.t0 + m.beat * bm;
    if (tm < now - 30) continue;
    playMelodyNote(m.midi, S.audio.currentTime + Math.max(0, (tm - now) / 1000), m.dur * bm / 1000);
  }
}
function playMelodyNote(midi, at, dur) {
  const smp = nearestSample(midi); if (!smp) return;
  const old = S.voices.mel;
  if (old) { try { old.g.gain.setTargetAtTime(0, at, 0.015); old.src.stop(at + 0.12); } catch {} }
  const src = S.audio.createBufferSource(), g = S.audio.createGain();
  src.buffer = smp.buf; src.playbackRate.value = Math.pow(2, (midi - smp.midi) / 12);
  g.gain.setValueAtTime(1.0, at); g.gain.setTargetAtTime(0, at + dur * 0.97, 0.06);
  src.connect(g).connect(S.master); src.start(at); src.stop(at + dur + 0.5);
  S.voices.mel = { src, g };
}
// The Mac strums the song: in Listen, and in Fixed tempo when Backing is ticked.
const backingOn = () => S.demo || (S.backing && S.mode === 'fixed');
// ---------- strum patterns ----------
// One character per eighth note across one bar: D = down-strum, U = up-strum, B = bass note (root),
// A = alternate bass note, . = rest. A song can set its own "pattern" (and "swing": true for a shuffle).
const DEFAULT_PATTERNS = { 2: 'B.DU', 3: 'B.D.D.', 4: 'D.DU.UDU' };
// Strum level: Easy and Medium are simpler stand-ins for the song's real (Full) pattern.
const LEVEL_PATTERNS = {
  easy:   { 2: 'D.D.', 3: 'D.....', 4: 'D.D.D.D.' },
  medium: { 2: 'B.D.', 3: 'D.D.D.', 4: 'D.DUD.DU' },
};
function songPattern() {
  const bpb = S.song?.beatsPerBar || 4, lvl = LEVEL_PATTERNS[S.strumLevel];
  // Easy = one down-strum at the start of every block, so it always matches "Strums per bar".
  if (S.strumLevel === 'easy') {
    const step = S.slotBeats || bpb / S.spb;
    return Array.from({ length: bpb * 2 }, (_, k) => (Math.abs(((k / 2) / step) - Math.round((k / 2) / step)) < 1e-6 ? 'D' : '.')).join('');
  }
  if (lvl && lvl[bpb]) return lvl[bpb];
  return (S.song?.pattern || DEFAULT_PATTERNS[bpb] || 'D.'.repeat(bpb)).replace(/\s+/g, '');
}
function chordAtBeat(beat) {
  let c = S.slots[0]?.chord;
  for (const s of S.slots) { if (s.beat > beat + 1e-6) break; c = s.chord; }
  return c;
}
function playBass(chord, alt, at, vel) {
  const v = (VOICINGS[chord] || voicing(chord)).filter(n => n != null);
  if (!v.length) return;
  playNote('bass', alt ? (v[1] ?? v[0] + 7) : v[0], at, 0.5 + 0.35 * Math.min(1, vel / 100));
}
function scheduleDemo() {
  if (!backingOn() || !S.playing || !S.audio || !S.samples || !S.slots.length) return;
  const now = performance.now(), bm = beatMs(), pat = songPattern(), bpb = S.song.beatsPerBar || 4;
  const endBeat = S.slots[S.slots.length - 1].beat + (S.slotBeats || 1);
  while ((S.demoTick || 0) < endBeat * 2) {
    const k = S.demoTick || 0, swing = S.song.swing && k % 2 ? 1 / 6 : 0;   // shuffle: off-beats land late
    const beat = k / 2 + swing, tk = S.t0 + beat * bm;
    if (tk > now + 120) break;
    S.demoTick = k + 1;
    if (tk < now - 30) continue;
    const ch = pat[k % pat.length];
    if (!ch || ch === '.') continue;
    const at = S.audio.currentTime + Math.max(0, (tk - now) / 1000);
    const chord = chordAtBeat(beat), vel = k % (bpb * 2) === 0 ? 92 : (k % 2 ? 62 : 76);
    if (ch === 'D' || ch === 'U') strumChord(chord, ch === 'D' ? 'down' : 'up', vel, at);
    else if (ch === 'B' || ch === 'A') playBass(chord, ch === 'A', at, vel);
  }
}

// ---------- Jam with the band: drums + bass behind the guitar ----------
// The band plays in Listen and Fixed tempo, following the song clock and the Tempo slider. In Follow me
// (no clock: the song waits for you) each good strum gets a bass note and a drum hit instead.
// Drums are made right here in the browser (no recordings to license); the bass is the FluidR3 acoustic
// bass (same free CC BY 3.0 sound set as the guitar). Style "auto" = the song's own "band" setting.
const BASS_URLS = [
  'sounds/acoustic_bass-mp3.js',   // local copy, if present
  'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_bass-mp3.js',
  'https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/acoustic_bass-mp3.js',
];
// One bar, one character per eighth note. Lanes: K kick, S snare, B brush swish, H hi-hat / brush tap,
// L bass (R = root, F = fifth). x = hit, o = soft hit, . = rest.
const BAND_STYLES = {
  folk: {
    2: { K: 'o...', B: '..x.', H: 'o.o.', L: 'R.F.' },
    3: { K: 'o.....', B: '..o.o.', H: 'o.o.o.', L: 'R...F.' },
    4: { K: 'o...o...', B: '..x...x.', H: 'o.o.o.o.', L: 'R...F...' },
  },
  country: {   // the "train beat": boom-chick bass, snare on the back beat, steady eighths
    2: { K: 'x...', S: '..x.', H: 'oxox', L: 'R.F.' },
    3: { K: 'x.....', S: '..o.o.', H: 'oxoxox', L: 'R...F.' },
    4: { K: 'x...x...', S: '..x...x.', H: 'oxoxoxox', L: 'R...F...' },
  },
  rock: {
    2: { K: 'x.x.', S: '..x.', H: 'xxxx', L: 'RRRR' },
    3: { K: 'x...x.', S: '..x...', H: 'xxxxxx', L: 'RRRRRR' },
    4: { K: 'x...xx..', S: '..x...x.', H: 'xxxxxxxx', L: 'RRRRRRRR' },
  },
};
const bandStyle = () => { const b = S.band === 'auto' ? (S.song?.band || 'folk') : S.band; return BAND_STYLES[b] ? b : null; };
const bandOn = () => !!bandStyle();
async function loadBass() {
  if (S.bassState === 'loading' || S.bassState === 'ready') return;
  ensureAudio(); if (!S.audio) return;
  S.bassState = 'loading';
  let text = null;
  for (const u of BASS_URLS) { try { const r = await fetch(u); if (r.ok) { text = await r.text(); break; } } catch {} }
  if (!text) { S.bassState = 'failed'; return; }
  const re = /"([A-G]b?)(\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g, out = {}, jobs = [];
  let m;
  while ((m = re.exec(text))) {
    const midi = FLATS.indexOf(m[1]) + 12 * (+m[2] + 1);
    if (midi < 24 || midi > 55) continue;
    const b64 = m[3];
    jobs.push((async () => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try { out[midi] = await S.audio.decodeAudioData(bytes.buffer); } catch {}
    })());
  }
  await Promise.all(jobs);
  S.bassSamples = out; S.bassState = Object.keys(out).length ? 'ready' : 'failed';
}
function bandOut() {   // the band's own volume (Band slider), into the main mixer
  if (!S.audio || !S.master) return null;
  if (!S.bandGain) { S.bandGain = S.audio.createGain(); S.bandGain.gain.value = S.bandLevel; S.bandGain.connect(S.master); }
  if (!S.noise) {
    const n = S.audio.sampleRate, b = S.audio.createBuffer(1, n, n), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    S.noise = b;
  }
  return S.bandGain;
}
function noiseHit(at, lvl, type, freq, q, attack, decay) {
  const out = bandOut(); if (!out) return;
  const src = S.audio.createBufferSource(), f = S.audio.createBiquadFilter(), g = S.audio.createGain();
  src.buffer = S.noise; src.playbackRate.value = 0.9 + Math.random() * 0.2;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(lvl, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * 0.5); src.stop(at + attack + decay + 0.05);
}
function toneHit(at, lvl, type, f0, f1, decay) {
  const out = bandOut(); if (!out) return;
  const o = S.audio.createOscillator(), g = S.audio.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + decay * 0.6);
  g.gain.setValueAtTime(lvl, at); g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  o.connect(g).connect(out); o.start(at); o.stop(at + decay + 0.05);
}
const DRUMS = {
  K: (at, v) => { toneHit(at, 0.95 * v, 'sine', 120, 42, 0.38); noiseHit(at, 0.12 * v, 'highpass', 3000, 0.7, 0.001, 0.012); },
  S: (at, v) => { toneHit(at, 0.22 * v, 'triangle', 200, 160, 0.11); noiseHit(at, 0.42 * v, 'bandpass', 1900, 0.8, 0.001, 0.17); },
  B: (at, v) => noiseHit(at, 0.26 * v, 'bandpass', 3200, 0.6, 0.035, 0.22),
  H: (at, v) => noiseHit(at, 0.12 * v, 'highpass', 7500, 0.8, 0.001, 0.045),
};
function bassNotes(chord) {   // root in the low bass range (E1..D#2), and its fifth
  const pc = chordPCs(chord); if (!pc) return null;
  let r = 24 + pc.root; if (r < 28) r += 12;
  return { root: r, fifth: r + 7 <= 43 ? r + 7 : r - 5 };
}
function playBassNote(midi, at, dur, lvl) {
  const out = bandOut(), s = S.bassSamples; if (!out || !s) return;
  let m = null; for (let d = 0; d <= 3 && m == null; d++) for (const x of [midi - d, midi + d]) if (s[x]) { m = x; break; }
  if (m == null) return;
  const old = S.bassVoice;
  if (old) { try { old.g.gain.setTargetAtTime(0, at, 0.02); old.src.stop(at + 0.15); } catch {} }
  const src = S.audio.createBufferSource(), g = S.audio.createGain();
  src.buffer = s[m]; src.playbackRate.value = Math.pow(2, (midi - m) / 12);
  g.gain.setValueAtTime(lvl, at); g.gain.setTargetAtTime(0, at + Math.max(0.08, dur * 0.92), 0.05);
  src.connect(g).connect(out); src.start(at); src.stop(at + dur + 0.6);
  S.bassVoice = { src, g };
}
function scheduleBand() {
  const st = bandStyle();
  if (!st || !timed() || !S.audio || !S.slots.length || !bandOut()) return;
  if (S.bassState !== 'ready') loadBass();
  const bpb = S.song.beatsPerBar || 4, pat = BAND_STYLES[st][bpb] || BAND_STYLES[st][4];
  const now = performance.now(), bm = beatMs(), n = bpb * 2;
  const endBeat = S.slots[S.slots.length - 1].beat + (S.slotBeats || 1);
  while ((S.bandTick || 0) < endBeat * 2) {
    const k = S.bandTick || 0, swing = S.song.swing && k % 2 ? 1 / 6 : 0;
    const beat = k / 2 + swing, tk = S.t0 + beat * bm;
    if (tk > now + 120) break;
    S.bandTick = k + 1;
    if (tk < now - 30) continue;
    const at = S.audio.currentTime + Math.max(0, (tk - now) / 1000), j = k % n;
    for (const lane of ['K', 'S', 'B', 'H']) {
      const c = pat[lane]?.[j];
      if (c === 'x' || c === 'o') DRUMS[lane](at, c === 'x' ? 1 : 0.6);
    }
    const c = pat.L[j];
    if (c === 'R' || c === 'F') {
      const chord = chordAtBeat(beat), b = bassNotes(chord); if (!b) continue;
      let note = c === 'F' ? b.fifth : b.root;
      // walk up (or down) into the next chord when it changes within the next beat
      const next = chordAtBeat(beat + 1);
      if (next !== chord && chordAtBeat(beat - 0.5) === chord) {
        const nb = bassNotes(next);
        if (nb) { let t = nb.root; while (t - b.root > 6) t -= 12; while (b.root - t > 6) t += 12; note = t + (t > b.root ? -2 : t < b.root ? 2 : 0); if (note === t) note = b.fifth; }
      }
      let len = 1; while (len < n - j && pat.L[j + len] === '.') len++;
      playBassNote(note, at, len * bm / 2000, c === 'R' ? 0.95 : 0.8);
    }
  }
}
// Follow me: no clock, so the band answers each good strum (bass on the beat, kick at the bar, brush otherwise).
function bandStrum(slot) {
  if (!bandOn() || !S.audio) return;
  if (S.bassState !== 'ready') { loadBass(); return; }
  if (!bandOut()) return;
  const at = S.audio.currentTime + 0.005, b = bassNotes(slot.chord);
  const first = slot.firstOfBar || slot.firstOfCell;
  if (b) playBassNote((S.bandFlip = !S.bandFlip) || first ? b.root : b.fifth, at, 1.2, 0.9);
  if (first) DRUMS.K(at, 0.9); else DRUMS[bandStyle() === 'folk' ? 'B' : 'S'](at, 0.8);
}

// ---------- sung vocal (song.vocal: a recorded singer, made with OpenUtau; see the song's vocal.credit) ----------
// One audio file with every verse sung back to back at vocal.bpm. It follows the song clock in Listen and
// Fixed tempo, sped up or slowed to the Tempo slider without changing pitch. Off in Follow me (a singer can't wait).
const voxOn = () => S.vocalsOn && !!S.song?.vocal;
function voxEl() {
  if (S.vox) return S.vox;
  const a = new Audio(); a.preload = 'auto'; a.preservesPitch = true; S.vox = a;
  try {   // route through the app's mixer so it follows the volume slider and the chosen speakers
    if (S.audio && S.master) {
      const n = S.audio.createMediaElementSource(a); S.voxGain = S.audio.createGain(); S.voxGain.gain.value = S.voiceLevel;
      n.connect(S.voxGain).connect(S.master);
    } else a.volume = Math.min(1, S.voiceLevel);
  } catch {}
  return a;
}
function voxTarget() {   // seconds into the recording for the current song position, or null
  const v = S.song.vocal, b = (performance.now() - S.t0) / beatMs();
  for (const g of S.voxSegs || []) if (b >= g.a && b < g.b) return (b - g.a + g.off) * 60 / v.bpm;
  return null;
}
function voxTick() {
  const a = S.vox;
  if (!voxOn() || !timed()) { if (a && !a.paused) a.pause(); return; }
  const v = S.song.vocal, el = voxEl(), src = 'songs/' + v.file;
  if (el.dataset.src !== src) {   // load the whole file into memory first: then it can jump anywhere on any web server
    el.dataset.src = src; el.dataset.ready = '';
    fetch(src).then(r => r.ok ? r.blob() : null).then(bl => {
      if (bl && el.dataset.src === src) { if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src); el.src = URL.createObjectURL(bl); el.dataset.ready = '1'; }
    }).catch(() => {});
  }
  if (el.dataset.ready !== '1') return;
  const t = voxTarget();
  if (t == null || (el.duration && t >= el.duration - 0.05)) { if (!el.paused) el.pause(); return; }
  const rate = S.tempo / v.bpm;
  if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
  if (el.paused) { el.currentTime = t; el.play().catch(() => {}); return; }
  if (Math.abs(el.currentTime - t) > 0.15) el.currentTime = t;   // drifted (tempo change, verse jump): re-sync
}

// ---------- metronome ----------
function scheduleClicks() {
  if (!S.audio || !timed()) return;
  const now = performance.now(), horizon = now + 150, bm = beatMs(), bpb = S.song.beatsPerBar || 4;
  while (S.t0 + S.nextBeat * bm < horizon) {
    const tb = S.t0 + S.nextBeat * bm;
    const inCount = S.nextBeat < 0;
    if (tb >= now - 5 && ((S.click && !S.demo) || inCount)) {
      const at = S.audio.currentTime + Math.max(0, (tb - now) / 1000);
      const accent = ((S.nextBeat % bpb) + bpb) % bpb === 0;
      const o = S.audio.createOscillator(), g = S.audio.createGain();
      o.frequency.value = accent ? 1560 : 1040;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      o.connect(g).connect(S.audio.destination); o.start(at); o.stop(at + 0.06);
    }
    if (inCount) {
      const n = -S.nextBeat; const delay = Math.max(0, tb - now);
      setTimeout(() => { if (S.playing && performance.now() < S.countInUntil + 50) showMsg(String(n), bm * 0.8); }, delay);
    }
    S.nextBeat++;
  }
}

// ---------- rendering ----------
let msgTimer = null;
function showMsg(text, ms) { const m = $('msg'); m.textContent = text; m.classList.remove('hidden'); clearTimeout(msgTimer); msgTimer = setTimeout(hideMsg, ms); }
function hideMsg() { $('msg').classList.add('hidden'); }

function renderControls() {
  document.querySelectorAll('#mode-seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('#sound-seg button').forEach(b => b.classList.toggle('on', b.dataset.sound === S.sound));
  const normal = S.song?.normalTempo || 80;
  // The slider goes past the song's normal speed (up to 150%) for anyone who likes it faster.
  const tr = $('tempo'); tr.max = Math.round(normal * 1.5); tr.min = Math.max(20, Math.round(normal * 0.35)); tr.value = Math.min(S.tempo, +tr.max);
  $('tempo-val').textContent = `${S.tempo} BPM` + (S.tempo === normal ? ' (normal)' : ` · ${Math.round(100 * S.tempo / normal)}%`);
  const free = S.mode === 'free';
  $('tempo-ctl').classList.toggle('hidden', free);   // tempo applies to Fixed tempo and Listen
  ['start', 'listen', 'restart', 'verse-pick'].forEach(id => $(id).classList.toggle('hidden', free));
  $('spb').parentElement.classList.toggle('hidden', free);
  $('click-ctl').classList.toggle('hidden', S.mode !== 'fixed');
  $('backing-ctl').classList.toggle('hidden', S.mode !== 'fixed');
  $('backing').checked = S.backing;
  $('spb').value = String(S.spb);
  $('click').checked = S.click;
  $('melody').checked = S.melodyOn;
  $('vocals').checked = S.vocalsOn; $('vocals-ctl').classList.toggle('hidden', !S.song?.vocal);
  $('voice-ctl').classList.toggle('hidden', !S.song?.vocal || !S.vocalsOn);
  $('band-ctl').classList.toggle('hidden', !bandOn());
}

// Natural mode: the six strings and the last note each one played (fades after a few seconds).
const STRING_NAMES = ['6 · low E', '5 · A', '4 · D', '3 · G', '2 · B', '1 · high E'];
function renderStrings() {
  const now = performance.now(), st = S.strings || {};
  $('neck').innerHTML = [0, 1, 2, 3, 4, 5].map(s => {
    const e = st[s], fresh = e && now - e.t < 4000;
    return `<div class="fret ${fresh ? 'want' : 'dimmed'}"><span class="sw" style="background:#d9d4c7">${6 - s}</span>` +
           `<span class="nm">${fresh ? noteName(e.note) : '—'}</span><span class="tag">${STRING_NAMES[s]}</span></div>`;
  }).join('');
}
function renderNeck(want) {
  if (S.sound === 'finger') return renderStrings();
  const ec = S.song?.easyChord || {}, used = new Set(S.slots.map(s => s.chord));
  const heard = S.last && S.last.chord;
  $('neck').innerHTML = [1,2,3,4,5,6,7].map(f => {
    const c = ec[f] || '—';
    const cls = ['fret', used.has(c) || S.mode === 'free' ? '' : 'dimmed', c === want ? 'want' : '',
      heard && c === heard ? 'heard' : '', heard && c === heard && S.last.res === 'wrong' ? 'wrong' : ''].join(' ');
    return `<div class="${cls}"><span class="sw" style="background:${FRET_COLORS[f]}">${f}</span>` +
           `<span class="nm">${c}</span><span class="tag">${FRET_NAMES[f]}</span></div>`;
  }).join('');
}

function nextChange(i) {
  for (let j = i + 1; j < S.slots.length; j++) if (S.slots[j].chord !== S.slots[i].chord) return { j, chord: S.slots[j].chord, inN: j - i };
  return null;
}

let lastKey = '';
function renderNow() {
  if (!S.song || !S.slots.length) return;
  if (S.mode === 'free') return renderFree();
  const i = currentIndex(), slot = S.slots[i];
  const key = [i, S.playing, S.demo, S.mode, S.last && S.last.t].join('|');
  if (key === lastKey) return; lastKey = key;
  const f = chordFret(slot.chord), col = chordColor(slot.chord);
  $('now-chord').textContent = slot.chord;
  $('now-fret').style.background = col;
  $('now-fret').querySelector('.n').textContent = f ?? '?';
  $('now-card').style.background = `linear-gradient(90deg, ${col}33, #1b1e24 70%)`;
  const doneCount = S.slots.filter(s => s.res).length;
  $('now-sub').textContent = S.demo ? 'Listening — watch the frets and words' : !S.playing
    ? (S.mode === 'follow' ? 'Strum to begin — the song waits for you' : 'Press Start — one bar count-in')
    : `${f ? FRET_NAMES[f] + ' fret · ' : 'not set up in Easy Chord · '}${doneCount}/${S.slots.length}`;
  const nc = nextChange(i);
  if (nc) {
    $('next-dot').style.background = chordColor(nc.chord);
    $('next-dot').textContent = chordFret(nc.chord) ?? '?';
    $('next-name').textContent = nc.chord;
  } else { $('next-dot').style.background = 'transparent'; $('next-dot').textContent = ''; $('next-name').textContent = 'end'; }
  renderNeck(slot.chord);
  renderLyrics(slot);
}

function lineCells(verse, line) { return S.slots.filter(s => s.verse === verse && s.line === line && s.firstOfCell); }
function lineHTML(cells, curCell) {
  return cells.map((b, i) => {
    const showChord = i === 0 || cells[i - 1].chord !== b.chord;
    return `<div class="lyr-bar ${b.cell === curCell ? 'cur' : ''} ${b.word ? '' : 'empty'}" style="border-left-color:${showChord ? chordColor(b.chord) : 'transparent'}">` +
      `<div class="c">${showChord ? `<i style="background:${chordColor(b.chord)}"></i>${b.chord}` : ''}</div><div class="w">${b.word || '&nbsp;'}</div></div>`;
  }).join('');
}
function renderLyrics(slot) {
  $('lyr-cur').innerHTML = lineHTML(lineCells(slot.verse, slot.line), slot.cell);
  const lines = S.song.lines.length;
  let nv = slot.verse, nl = slot.line + 1;
  if (nl >= lines) { nl = 0; nv = S.slots.find(s => s.verse > slot.verse)?.verse ?? -1; }
  $('lyr-next').innerHTML = nv >= 0 ? lineHTML(lineCells(nv, nl), -1) : '';
  $('verse-name').textContent = '· ' + S.song.verses[slot.verse].name;
}

function renderSound() {
  const el = $('sound-status');
  if (S.sound === 'guitar') { el.innerHTML = ''; return; }
  if (S.sound === 'silent') { el.innerHTML = '<b>Silent practice</b> — your strums make no sound but are still read and graded. Turn the guitar\'s volume knob down. Tip: Fixed tempo + Backing.'; return; }
  const st = S.samplesState;
  el.innerHTML = st === 'ready'
    ? `<b>${S.sound === 'finger' ? 'Natural mode — Easy Chord ' + (L.easy === false ? 'off' : '(connect to turn it off)') + ', the computer plays every string as you play it' : 'Computer sound on'}</b> → ${S.speaker ? S.speaker : '<span style="color:var(--early)">the computer\'s current output</span>'}. Turn the guitar's volume knob all the way down so you only hear the clean strum.`
    : st === 'loading' ? 'Loading guitar sound…'
    : st === 'failed' ? `<span style="color:var(--bad)">Couldn't load the guitar sound (needs internet the first time).</span>`
    : 'Click anywhere on this page to turn on the computer sound.';
}
function renderSide() {
  renderSound();
  const L = S.last;
  if (!L) $('last').innerHTML = '<span class="kbd">Last strum shows here.</span>';
  else {
    const arrow = L.dir === 'down' ? '↓' : '↑';
    let verdict = '';
    if (L.res === 'ok') verdict = `<span style="color:var(--ok)">✓ ${S.mode === 'fixed' ? 'on time' : 'good'}</span>`;
    else if (L.res === 'early') verdict = `<span style="color:var(--early)">early ${Math.round(-L.err)} ms</span>`;
    else if (L.res === 'late') verdict = `<span style="color:var(--late)">late ${Math.round(L.err)} ms</span>`;
    else if (L.res === 'wrong') verdict = `<span style="color:var(--bad)">✗ wanted ${L.want}</span>`;
    else if (L.res === 'extra') verdict = '<span class="kbd">extra strum</span>';
    else if (L.res === 'free') verdict = '';
    else verdict = '<span class="kbd">not playing</span>';
    $('last').innerHTML = `<h2>Last strum</h2><span class="big" style="color:${chordColor(L.chord)}">${L.chord || '?'}</span> ` +
      `<span style="font-size:24px">${arrow}</span> ${verdict}<div class="kbd">loudness ${L.vel}/127</div>`;
  }
  // pace / tempo
  const normal = S.song?.normalTempo || 80;
  if (S.mode === 'follow') {
    if (S.okTimes.length >= 3) {
      const iv = (S.okTimes[S.okTimes.length - 1] - S.okTimes[0]) / (S.okTimes.length - 1);
      const bpm = Math.round(60000 / (iv * S.spb / (S.song.beatsPerBar || 4)));
      $('pace').innerHTML = `<h2>Your pace</h2><b>${bpm} BPM</b> · ${Math.round(100 * bpm / normal)}% of normal (${normal})`;
    } else $('pace').innerHTML = `<h2>Your pace</h2>Play a few strums…`;
  } else $('pace').innerHTML = '';
  const st = S.stats;
  if (st && st.tries) {
    $('stats').innerHTML = S.mode === 'fixed'
      ? `<h2>This run</h2>On time <b style="color:var(--ok)">${st.ok}</b> · early ${st.early} · late ${st.late}<br>` +
        `Wrong chord ${st.wrong} · missed ${st.miss}<br>Average timing error ${st.errN ? Math.round(st.errSum / st.errN) : '–'} ms`
      : `<h2>This run</h2>Good strums <b style="color:var(--ok)">${st.ok}</b> · wrong chord ${st.wrong}`;
  } else $('stats').innerHTML = '';
}

function renderSetup() {
  const ec = S.song?.easyChord || {}, need = [...new Set(S.slots.map(s => s.chord))];
  const missing = need.filter(c => !chordFret(c));
  $('setup').innerHTML = (S.importReport ? `<div style="color:var(--ok);margin-bottom:8px">${S.importReport}</div>` : '') + `<h2>Guitar setup</h2>💡 Connect sets the guitar up for you: Classic mode, with this song's chords on the frets.` +
    (missing.length ? `<div style="color:var(--bad)">Not on any fret: ${missing.join(', ')}</div>` : '');
}

function renderAll() { lastKey = ''; renderControls(); renderNow(); renderSide(); renderSetup(); }

// ---------- lane (the replacement for the guitar's lights) ----------
const lane = $('lane'), ctx2d = lane.getContext('2d');
function drawLane() {
  const dpr = window.devicePixelRatio || 1, W = lane.clientWidth, H = lane.clientHeight;
  if (lane.width !== W * dpr) { lane.width = W * dpr; lane.height = H * dpr; }
  const g = ctx2d; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (S.mode === 'free') return drawFree(g, W, H);
  if (!S.slots.length) return;
  const px = Math.max(64, W / 11), nowX = Math.round(W * 0.22), top = 22, bh = 74;
  let p;
  if (timed()) p = fixedPos();
  else { S.shownPos += (S.pos - S.shownPos) * 0.25; if (Math.abs(S.pos - S.shownPos) < 0.01) S.shownPos = S.pos; p = S.mode === 'fixed' ? 0 : S.shownPos; }

  // missed slots (fixed mode)
  if (timed()) {
    const lim = Math.floor(p - 0.5);
    for (let k = 0; k <= lim && k < S.slots.length; k++) if (!S.slots[k].res && !S.demo) { S.slots[k].res = 'miss'; S.stats.miss++; renderSide(); }
    if (p > S.slots.length + 0.5) finish();
  }

  const first = Math.max(0, Math.floor(p - nowX / px) - 1), last = Math.min(S.slots.length - 1, Math.ceil(p + (W - nowX) / px) + 1);
  g.font = '600 20px -apple-system, Helvetica, sans-serif'; g.textBaseline = 'middle';
  for (let i = first; i <= last; i++) {
    const s = S.slots[i], x = nowX + (i - p) * px;
    const past = i < p - 0.5;
    g.globalAlpha = past ? 0.35 : 1;
    g.fillStyle = chordColor(s.chord);
    const gap = s.firstOfBar ? 6 : 2;
    roundRect(g, x + gap, top, px - gap - 2, bh, 9); g.fill();
    g.fillStyle = '#111'; g.textAlign = 'left';
    g.fillText(s.chord, x + gap + 10, top + bh / 2 - 8);
    // The strums the song's pattern expects in this block: ↓ down, ↑ up, • bass note.
    const pat = songPattern(), sb = S.slotBeats || 1, inner = px - gap - 2;
    g.font = '700 15px -apple-system, Helvetica, sans-serif';
    // Follow me waits for ONE strum per block, so show just that one (the first strum the pattern has there).
    const oneStrum = S.mode === 'follow' && !S.demo;
    for (let k = Math.ceil(s.beat * 2 - 1e-6); k / 2 < s.beat + sb - 1e-6; k++) {
      const ch = pat[k % pat.length]; if (!ch || ch === '.') continue;
      const ax = x + gap + 6 + ((k / 2 - s.beat) / sb) * (inner - 12);
      if (oneStrum) { g.fillText(ch === 'U' ? '↑' : '↓', x + gap + 10, top + bh - 14); break; }
      g.fillText(ch === 'D' ? '↓' : ch === 'U' ? '↑' : '•', ax, top + bh - 14);
    }
    g.font = '600 20px -apple-system, Helvetica, sans-serif';
    if (s.firstOfBar) { g.fillStyle = '#ffffff55'; g.fillRect(x + 1, top - 8, 2, bh + 16); }
    g.globalAlpha = 1;
    if (s.res) {
      const arrow = s.heardDir === 'up' ? '↑' : s.heardDir === 'down' ? '↓' : '';
      const sym = { ok:'✓' + arrow, early:'early' + arrow, late:'late' + arrow, wrong:'✗ ' + (s.heard || '') + arrow, miss:'·' }[s.res];
      const col = { ok:'#4fd18b', early:'#f2b84b', late:'#ff8a5c', wrong:'#ff5a5a', miss:'#666' }[s.res];
      g.fillStyle = col; g.font = '600 15px -apple-system, Helvetica, sans-serif'; g.textAlign = 'left';
      g.fillText(sym, x + gap + 8, top + bh + 22);
      g.font = '600 20px -apple-system, Helvetica, sans-serif';
    }
  }
  // strum ticks (where you actually strummed)
  if (S.mode === 'fixed') {
    for (const m of S.marks) {
      const x = nowX + (m.pos - p) * px;
      if (x < -5 || x > W + 5) continue;
      g.fillStyle = '#ffffff'; g.fillRect(x - 1.5, top - 12, 3, bh + 24);
    }
  }
  // now line
  g.fillStyle = '#fff'; g.fillRect(nowX - 1, 4, 3, H - 8);
  g.beginPath(); g.moveTo(nowX - 8, 4); g.lineTo(nowX + 9, 4); g.lineTo(nowX + 0.5, 15); g.closePath(); g.fill();
  g.font = '12px -apple-system, Helvetica, sans-serif'; g.fillStyle = '#8b919b'; g.textAlign = 'left';
  g.fillText(S.demo ? 'listen — this is how it should sound' : S.mode === 'fixed' ? 'strum when a block reaches the line' : 'the song waits for your strum', nowX + 10, 10);
}
// Free play lane: your recent strums scrolling left, newest at the right edge.
function drawFree(g, W, H) {
  const now = performance.now(), pxPerSec = 110, right = W - 40, top = 22, bh = 74;
  g.font = '600 20px -apple-system, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const e of (S.freeLog || [])) {
    const x = right - (now - e.t) / 1000 * pxPerSec;
    if (x < -80) continue;
    g.fillStyle = S.sound === 'finger' ? '#d9d4c7' : chordColor(e.chord); roundRect(g, x - 30, top, 60, bh, 9); g.fill();
    g.fillStyle = '#111'; g.fillText(e.chord || '?', x - 22, top + bh / 2);
  }
  g.font = '12px -apple-system, Helvetica, sans-serif'; g.fillStyle = '#8b919b';
  g.fillText('free play — your strums, newest on the right', 10, 10);
}
function renderFree() {
  const key = ['free', S.last && S.last.t].join('|');
  if (key === lastKey) return; lastKey = key;
  const natural = S.sound === 'finger';
  const c = S.last && S.last.chord, f = c && !natural ? chordFret(c) : null, col = c && !natural ? chordColor(c) : (c ? '#d9d4c7' : '#444');
  $('now-chord').textContent = c || '—';
  if (natural) {
    $('now-fret').style.background = col; $('now-fret').querySelector('.n').textContent = S.last?.pick ? '♪' : (c ? '♫' : '–');
    $('now-fret').querySelector('.l').textContent = S.last?.pick ? 'note' : 'chord';
    $('now-card').style.background = 'linear-gradient(90deg, #d9d4c722, #1b1e24 70%)';
    const ns = S.last?.notes ? [...S.last.notes].sort((a, b) => a - b).map(noteName) : [];
    $('now-sub').textContent = S.last ? (S.last.pick ? 'single note' : (ns.join(' · ') + (c ? '' : ' · not a standard chord'))) : 'Natural — play anything, like a real guitar';
    $('next-dot').style.background = 'transparent'; $('next-dot').textContent = ''; $('next-name').textContent = '';
    renderStrings();
    const recent = (S.freeLog || []).slice(-12);
    $('lyr-cur').innerHTML = recent.map(e => `<div class="lyr-bar" style="border-left-color:#d9d4c7"><div class="c">${e.chord || '—'}</div></div>`).join('');
    $('lyr-next').innerHTML = ''; $('verse-name').textContent = '· natural — what you played';
    return;
  }
  $('now-fret').querySelector('.l').textContent = 'fret';
  $('now-fret').style.background = col;
  $('now-fret').querySelector('.n').textContent = f ?? '–';
  $('now-card').style.background = `linear-gradient(90deg, ${col}33, #1b1e24 70%)`;
  $('now-sub').textContent = c ? `${f ? FRET_NAMES[f] + ' fret' : 'not on an Easy Chord fret'} · free play` : 'Free play — strum anything';
  $('next-dot').style.background = 'transparent'; $('next-dot').textContent = ''; $('next-name').textContent = '';
  renderNeck(c);
  const recent = (S.freeLog || []).slice(-12);
  $('lyr-cur').innerHTML = recent.map(e => `<div class="lyr-bar" style="border-left-color:${chordColor(e.chord)}"><div class="c"><i style="background:${chordColor(e.chord)}"></i>${e.chord}</div></div>`).join('');
  $('lyr-next').innerHTML = '';
  $('verse-name').textContent = '· free play — your last chords';
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function loop() {
  scheduleClicks();
  scheduleDemo();
  scheduleBand();
  scheduleMelody();
  voxTick();
  lightsTick();
  drawLane();
  renderNow();
  requestAnimationFrame(loop);
}

// ---------- fret lights (Bluetooth) ----------
// Commands copied from what the official app sends (captured with PacketLogger):
//   80 80 f3 LEN a5 00 SEQ CHK  ba fe F R G B (F+R+G+B)&ff   = set fret F (0-6) to colour R,G,B
// LEN = 5 + command length, CHK = (LEN + a5 + 00 + SEQ + sum(command)) & ff.
// No keep-alive is sent: the official app's keep-alive makes the guitar redraw its own colours.
const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR    = '7772e5db-3868-4112-a1a9-f2669d106bf3';
const LED_COLORS = [[0x00,0xfa,0x00],[0x00,0x19,0xff],[0xfa,0x1e,0x08],[0x64,0x0a,0xff],[0x1e,0xff,0x64],[0xff,0xff,0x00],[0xfa,0x14,0x32]];
const LED_GAP_MS = 150;          // the guitar drops commands sent faster than this
const PREVIEW_DIM = 0.22;        // brightness of the "next chord" fret
const LED_REFRESH_MS = 280;      // pace of the background re-send when nothing changes
const BLINK_MS = 180;            // how long the fret goes dark to say "got it, same chord again"
const L = { ch: null, dev: null, seq: 0x30, sent: null, busy: false, lastSend: 0, restoring: false, lastUsbNote: -1e9 };

function guitarFrame(cmd, flag = 0, seq = null) {
  if (seq == null) { L.seq = (L.seq + 1) & 0xff; seq = L.seq; }
  const len = 5 + cmd.length;
  const chk = (len + 0xa5 + flag + seq + cmd.reduce((a, x) => a + x, 0)) & 0xff;
  return new Uint8Array([0x80, 0x80, 0xf3, len, 0xa5, flag, seq, chk, ...cmd]);
}
// Session handshake, exactly as the official app opens every connection: bf 05 01 with flag 04, seq 01.
// The guitar echoes it; after that, command numbering restarts at 1.
async function handshake() {
  await L.ch.writeValueWithoutResponse(guitarFrame([0xbf, 0x05, 0x01], 0x04, 0x01));
  L.seq = 0;
  await new Promise(r => setTimeout(r, LED_GAP_MS));
}
function ledFrame(f, r, g, b) { return guitarFrame([0xba, 0xfe, f, r, g, b, (f + r + g + b) & 0xff]); }
// Classic mode (auto-accompaniment off) — the exact three commands the official app sent
// when switched from Smart to Classic (captured 23 Nov 2026).
const CLASSIC_MODE_CMDS = [[0xb5, 0x23, 0x00, 0x00], [0xb5, 0x16, 0x01, 0x00], [0xb0, 0x02, 0x00]];
// Easy Chord on/off — exactly what the official app sends (captured 23 Nov 2026, toggled 4×):
//   on:  ba 00 01, ~0.5 s later ba 00 02, then b0 02 00      off (real fretboard): ba 00 00, then b0 02 00
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function setEasyChord(on) {
  if (!L.ch) return;
  while (L.busy) await sleep(20);
  L.busy = true;
  try {
    const steps = on ? [[0xba, 0x00, 0x01], 500, [0xba, 0x00, 0x02], [0xb0, 0x02, 0x00]] : [[0xba, 0x00, 0x00], [0xb0, 0x02, 0x00]];
    for (const c of steps) {
      if (typeof c === 'number') { await sleep(c); continue; }
      await L.ch.writeValueWithoutResponse(guitarFrame(c)); await sleep(LED_GAP_MS);
    }
    L.easy = on;
    if (L.sent) L.sent = L.sent.map(() => null);   // the guitar repaints its frets on a mode change: redraw ours
  } catch {} finally { L.busy = false; L.lastSend = performance.now(); renderSound(); }
}
// ---------- Easy Chord layout per song: program the guitar's 7 frets ----------
// Captured format (23 Nov 2026): for each fret NN (01-07, and the same again as 11-17):
//   ba fa NN  hiE B G D A loE  chk   (fret per string, 7f = muted; chk = sum of NN..loE)
//   b5 1e fc NN  pc1 pc2 pc3 pc4  chk   (chord notes as pitch classes, 7f = unused; chk excludes fc)
// The official app sends each NN and NN+0x10 together in one frame, joined by 80 80.
const SHAPES = {   // low E -> high E; x = muted
  C:'x32010', Cm:'x35543', C7:'x32310', D:'xx0232', Dm:'xx0231', D7:'xx0212', E:'022100', Em:'022000', E7:'020100',
  F:'133211', Fm:'133111', F7:'131211', G:'320003', Gm:'355333', G7:'320001', A:'x02220', Am:'x02210', A7:'x02020',
  B:'x24442', Bm:'x24432', B7:'x21202', Bdim:'x23x31', 'A#':'x13331', 'D#':'xx1343', 'G#':'466544', 'C#':'x46664',
  'F#':'244322', 'F#m':'244222', 'C#m':'x46654', 'G#m':'466444', 'F#dim':'2342xx', 'C#dim':'x4565x', 'G#dim':'4564xx',
};
const SHARPN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const normChord = c => { const p = chordPCs(c); if (!p) return c; const q = /^[A-G][#b]?(.*)$/.exec(c)[1]; return SHARPN[p.root] + q; };
function chordShape(name) {
  const n = normChord(name);
  const s = SHAPES[n] || SHAPES[name];
  if (s) return s.split('').map(ch => ch === 'x' ? 0x7f : +ch);
  // fallback: nearest chord tone on each string within the first 4 frets, low strings muted until the root
  const p = chordPCs(name); if (!p) return [0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f];
  let seenRoot = false;
  return [40, 45, 50, 55, 59, 64].map(open => {
    for (let f = 0; f <= 4; f++) { const pc = (open + f) % 12; if (p.pcs.includes(pc)) { if (!seenRoot && pc !== p.root) continue; seenRoot = true; return f; } }
    return 0x7f;
  });
}
// Which chord goes on which fret, for this song.
//  'song': only the song's chords, ordered by where they sit in the key (home chord on fret 1, then up the scale)
//  'key' : all seven chords of the key, like AeroBand's own layout; song chords outside the key replace the same-root one
function easyLayout(song, mode = S.fretLayout) {
  const keyName = song.key || song.lines?.[0]?.[0]?.[0] || 'C', kp = chordPCs(keyName) || { root: 0, pcs: [0, 4, 7] };
  const minor = /m$|min$/.test(keyName) && !/dim$/.test(keyName), tonic = kp.root;
  const steps = minor ? [[0, 'm'], [2, 'dim'], [3, ''], [5, 'm'], [7, 'm'], [8, ''], [10, '']] : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm'], [11, 'dim']];
  const diatonic = steps.map(([i, q]) => SHARPN[(tonic + i) % 12] + q);
  const count = {}; (song.lines || []).flat().forEach(([c]) => { if (c) count[c] = (count[c] || 0) + 1; });
  let used = Object.keys(count);
  const deg = c => { const p = chordPCs(c); return p ? (p.root - tonic + 12) % 12 : 99; };
  let frets;
  if (mode === 'key') {
    frets = diatonic.slice();
    for (const c of used) {
      if (frets.some(f => normChord(f) === normChord(c))) continue;
      const i = frets.findIndex(f => chordPCs(f)?.root === chordPCs(c)?.root);
      if (i >= 0 && !used.some(u => normChord(u) === normChord(frets[i]))) frets[i] = c;
    }
  } else {
    if (used.length > 7) used = used.sort((a, b) => count[b] - count[a]).slice(0, 7);
    frets = used.sort((a, b) => deg(a) - deg(b) || a.length - b.length);
    for (const d of diatonic) if (frets.length < 7 && !frets.some(f => normChord(f) === normChord(d))) frets.push(d);
  }
  const ec = {}; frets.slice(0, 7).forEach((c, i) => ec[i + 1] = c);
  return ec;
}
async function programEasyChord(ec) {
  if (!L.ch) return false;
  while (L.busy) await sleep(20);
  L.busy = true;
  try {
    for (let f = 1; f <= 7; f++) {
      const chord = ec[f] || 'C', shape = chordShape(chord).slice().reverse();   // guitar wants high E first
      const p = chordPCs(chord) || { root: 0, pcs: [0, 4, 7] };
      const pcs = [...new Set([p.root, ...p.pcs])].slice(0, 4); while (pcs.length < 4) pcs.push(0x7f);
      const fa = n => { const b = [0xba, 0xfa, n, ...shape]; return [...b, b.slice(2).reduce((a, x) => a + x, 0) & 0xff]; };
      const fc = n => { const b = [0xb5, 0x1e, 0xfc, n, ...pcs]; return [...b, b.slice(3).reduce((a, x) => a + x, 0) & 0xff]; };
      await L.ch.writeValueWithoutResponse(guitarFrame([...fa(f), 0x80, 0x80, ...fa(f + 0x10)])); await sleep(LED_GAP_MS);
      await L.ch.writeValueWithoutResponse(guitarFrame([...fc(f), 0x80, 0x80, ...fc(f + 0x10)])); await sleep(LED_GAP_MS);
    }
    L.programmed = JSON.stringify(ec);
    return true;
  } catch { return false; } finally { L.busy = false; L.lastSend = performance.now(); }
}
// Put the current song's layout on the guitar (when connected and not in Natural mode).
async function applySongLayout() {
  if (!S.song) return;
  if (!S.song._factoryEC) S.song._factoryEC = S.song.easyChord;
  const ec = easyLayout(S.song);
  if (!L.ch) { S.song.easyChord = S.song._factoryEC || ec; renderAll(); return; }   // not connected: guitar keeps what it has
  if (S.sound === 'finger') return;
  if (L.programmed !== JSON.stringify(ec)) {
    showMsg('Setting up frets…', 3500);
    if (!(await programEasyChord(ec))) return;
    await setEasyChord(true);
    hideMsg();
  }
  S.song.easyChord = ec;
  if (L.sent) L.sent = L.sent.map(() => null);
  renderAll();
}
// ---------- Chord reset: put the guitar's factory chords back ----------
// The song layout StrumAlong writes stays on the guitar after it is switched off and on (tested 24 Nov 2026),
// so before going back to the AeroBand app or playing on its own, put back the factory layout:
// C Dm Em F G Am Bdim (byte-identical to the official app's factory layout), Easy Chord on,
// the guitar's own fret colours, then disconnect. Disconnecting (clicking "Connected") does the same.
const FACTORY_EC = { 1: 'C', 2: 'Dm', 3: 'Em', 4: 'F', 5: 'G', 6: 'Am', 7: 'Bdim' };
async function chordReset() {
  if (!L.ch) { showMsg('Connect to the guitar first', 2500); return; }
  if (L.restoring) return;
  showMsg('Resetting chords…', 12000);
  let ok = await programEasyChord(FACTORY_EC);
  if (ok) { await sleep(400); ok = await programEasyChord(FACTORY_EC); }   // twice: the guitar sometimes drops a command
  if (ok) await setEasyChord(true);
  if (ok) await sleep(2000);   // give the guitar time to save before disconnecting (tested on a real guitar, 24 Nov 2026)
  hideMsg();
  if (!ok) { showMsg('Chord reset failed – try again', 2500); return; }
  L.programmed = null;
  L.restoring = true; renderLights();      // lights back to the guitar's own colours, then disconnect
  showMsg('Chords reset ✓', 2500);
}
async function setClassicMode() {
  for (const c of CLASSIC_MODE_CMDS) { await L.ch.writeValueWithoutResponse(guitarFrame(c)); await new Promise(r => setTimeout(r, LED_GAP_MS)); }
}
const dim = (c, k) => c.map(x => Math.round(x * k));
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// What the 7 frets should show right now.
// Light rule: all 7 frets glow DIM in their own colour (so the colours are always visible);
// only the fret to strum now is BRIGHT. Never two bright frets. (Dim replaces off, bright replaces on.)
const BASE_DIM = 0.12;
const isBright = c => !!c && c[0] + c[1] + c[2] > 100;
function desiredLights() {
  const want = LED_COLORS.map(c => dim(c, BASE_DIM));
  if (L.restoring) return LED_COLORS.slice();
  if (!S.slots.length) return want;
  if (S.mode === 'free') {   // free play: the fret you last strummed is bright
    const lf = S.last && S.last.chord ? chordFret(S.last.chord) : null;
    if (lf) want[lf - 1] = LED_COLORS[lf - 1];
    return want;
  }
  const i = currentIndex(), f = chordFret(S.slots[i].chord);
  // Right after a good strum, ALL lights go dark for a moment (your strum registered), then the next fret lights.
  if (S.lastOk && (performance.now() - S.lastOk.t < BLINK_MS || L.blinkDone !== S.lastOk.t)) return want;
  if (f) want[f - 1] = LED_COLORS[f - 1];
  return want;
}
// Called every frame: sends at most one changed fret every LED_GAP_MS.
function lightsTick() {
  if (!L.ch || !L.sent || L.busy || performance.now() - L.lastSend < LED_GAP_MS) return;
  const F = [0, 1, 2, 3, 4, 5, 6], isOn = isBright;
  // The post-strum blink counts as done once every fret we lit is confirmed dark.
  if (S.lastOk && L.blinkDone !== S.lastOk.t && !F.some(i => isOn(L.sent[i]))) L.blinkDone = S.lastOk.t;
  const want = desiredLights(), dirty = (L.dirty ||= new Set());
  let k = -1, repeat = true;
  // Priority 1: bring any bright fret that should now be dim back down.
  k = F.find(i => isOn(L.sent[i]) && !isOn(want[i])) ?? -1;
  // Priority 2: brighten the fret to strum now.
  if (k < 0) k = F.find(i => isOn(want[i]) && !same(want[i], L.sent[i])) ?? -1;
  // Priority 3: frets you touched or let go of — the guitar re-lights those by itself, so correct them.
  if (k < 0 && dirty.size) { k = dirty.values().next().value; dirty.delete(k); repeat = false; }
  // Priority 4: anything else that differs.
  if (k < 0) k = F.find(i => !same(want[i], L.sent[i])) ?? -1;
  if (k >= 0) { if (repeat) (L.again ||= []).push(k); }   // each change is sent a second time later (the guitar sometimes drops one)
  else {
    if (L.restoring) { L.restoring = false; finishDisconnect(); return; }
    L.again = (L.again || []).filter(idx => same(want[idx], L.sent[idx]));
    if (L.again.length) {
      // repeat offs first
      const j = L.again.findIndex(idx => !want[idx].some(x => x));
      k = L.again.splice(j >= 0 ? j : 0, 1)[0];
    } else {
      // Nothing changed: re-send one fret's state, round-robin. The guitar sends no
      // acknowledgement for lights; this heals any drop (the official app also repeats).
      if (performance.now() - L.lastSend < LED_REFRESH_MS) return;
      k = L.rr = ((L.rr ?? -1) + 1) % 7;
    }
  }
  L.busy = true; L.lastSend = performance.now();
  L.ch.writeValueWithoutResponse(ledFrame(k, ...want[k]))
    .then(() => { L.sent[k] = want[k]; })
    .catch(() => {})
    .finally(() => { L.busy = false; });
}
// BLE MIDI notes, used only if no notes are arriving over the USB cable.
function onBleMidi(e) {
  const v = new Uint8Array(e.target.value.buffer);
  const rx = (window.BLE_RX ||= []);   // debug: raw replies from the guitar
  rx.push(Math.round(performance.now()) + ' ' + [...v].map(x => x.toString(16).padStart(2, '0')).join(' '));
  if (rx.length > 300) rx.shift();
  // Fret touch events: bX 31 F = finger down on fret F, bX 32 F = finger up (X = string).
  // The guitar re-lights a fret on its own when you touch/let go, so mark it to be corrected now and again shortly.
  for (let j = 0; j + 2 < v.length; j++) {
    if ((v[j] & 0xf0) === 0xb0 && (v[j + 1] === 0x31 || v[j + 1] === 0x32) && v[j + 2] >= 1 && v[j + 2] <= 7) {
      const f = v[j + 2] - 1, str = v[j] & 0x0f;
      // Remember which fret each string is held on (for Mac mode: the fret you hold decides the chord).
      const held = (L.held ||= {});
      if (v[j + 1] === 0x31) held[str] = f + 1; else if (held[str] === f + 1) delete held[str];
      // The guitar brightens a fret while you press it (built in, can't be turned off), so don't fight it
      // while held — only put the fret back once you lift your finger (now, and once more shortly after).
      if (v[j + 1] === 0x32 && !Object.values(held).includes(f + 1)) {
        (L.dirty ||= new Set()).add(f);
        setTimeout(() => L.dirty.add(f), 250);
      }
      j += 2;
    }
  }
  if (performance.now() - L.lastUsbNote < 3000) return;
  let i = 1, status = 0;
  while (i < v.length) {
    if (v[i] & 0x80) { i++; if (i < v.length && (v[i] & 0x80)) { status = v[i]; i++; } }
    if (status === 0xf3 || status >= 0xf0 || !status) break;
    const hi = status & 0xf0, n = (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
    if (i + n > v.length) break;
    const d1 = v[i], d2 = v[i + 1]; i += n;
    if (hi === 0x90 && d2 > 0) onNote(d1, d2, performance.now(), status & 0x0f);
  }
}
async function connectLights() {
  if (L.ch) { chordReset(); return; }   // "Disconnect": put the guitar back to factory, then disconnect
  if (!navigator.bluetooth) { showMsg('Use Chrome for lights', 1500); return; }
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
    const srv = await dev.gatt.connect();
    const ch = await (await srv.getPrimaryService(BLE_MIDI_SERVICE)).getCharacteristic(BLE_MIDI_CHAR);
    ch.addEventListener('characteristicvaluechanged', onBleMidi);
    await ch.startNotifications();
    dev.addEventListener('gattserverdisconnected', () => { L.ch = null; L.dev = null; renderLights(); });
    L.ch = ch; L.dev = dev;
    L.busy = true;                              // hold the lights until setup is done
    try { await handshake(); await setClassicMode(); } finally { L.busy = false; }
    L.sent = LED_COLORS.map(c => c.slice());   // the guitar starts showing its own colours
    L.programmed = null;
    if (S.sound === 'finger') await setEasyChord(false);   // Natural = real fretboard
    else await applySongLayout();                          // program this song's chords onto the frets, Easy Chord on
  } catch (err) { if (err.name !== 'NotFoundError') showMsg('Lights: ' + err.message, 2500); }
  renderLights();
}
function finishDisconnect() { try { L.dev && L.dev.gatt.disconnect(); } catch {} L.ch = null; L.dev = null; renderLights(); }
function renderGuitarChip() {
  const parts = [...(S.usbNames || []).map(n => n + ' (USB)'), ...(L.ch ? ['Bluetooth'] : [])];
  const g = $('guitar');
  g.textContent = parts.length ? parts.join(' + ') + ' ✓' : 'not connected';
  g.classList.toggle('ok', parts.length > 0);
}
function renderLights() {
  renderGuitarChip();
  const b = $('lights-btn');
  b.textContent = L.ch ? (L.restoring ? 'Disconnecting…' : '💡 Connected') : '💡 Connect';
  b.classList.toggle('on', !!L.ch);
}

// ---------- MIDI ----------
async function connectMIDI() {
  if (!navigator.requestMIDIAccess) { $('guitar').textContent = 'Use Chrome (no Web MIDI here)'; return; }
  try {
    const midi = await navigator.requestMIDIAccess({ sysex: false });
    const hook = () => {
      const ins = [...midi.inputs.values()];
      ins.forEach(i => { i.onmidimessage = e => {
        const d = e.data, st = d[0] & 0xf0;
        if (st === 0x90 && d[2] > 0) { L.lastUsbNote = performance.now(); onNote(d[1], d[2], e.timeStamp, d[0] & 0x0f); }
      }; });
      S.usbNames = ins.map(i => i.name);
      renderGuitarChip();
    };
    midi.onstatechange = hook; hook();
  } catch (e) { $('guitar').textContent = 'MIDI blocked: ' + e.message; }
}

// ---------- keyboard demo strums (no guitar needed) ----------
function voicing(chord) {
  const c = chordPCs(chord); if (!c) return [];
  return [40, 45, 50, 55, 59, 64].map(open => { for (let f = 0; f <= 4; f++) if (c.pcs.includes((open + f) % 12)) return open + f; return open; });
}
window.fakeStrum = (fret, up = false) => {
  const chord = S.song?.easyChord?.[fret]; if (!chord) return;
  let notes = voicing(chord); if (up) notes = notes.reverse();
  const t0 = performance.now();
  notes.forEach((n, i) => setTimeout(() => onNote(n, 70, t0 + i * 12), i * 12));
};

// ---------- songs ----------
function validSong(s) { return s && Array.isArray(s.verses) && Array.isArray(s.lines) && s.title; }
function useSong(song) {
  S.song = song;
  if (S.tempo > (song.normalTempo || 80)) S.tempo = song.normalTempo || 80;
  $('song-title').textContent = `${song.title} · ${song.artist || ''}`;
  $('song-credit').textContent = song.credit || '';
  const vp = $('verse-pick');
  vp.innerHTML = `<option value="all">All verses</option>` + song.verses.map((v, i) => `<option value="${i}">${v.name}</option>`).join('');
  if (S.verse !== 'all' && !song.verses[+S.verse]) S.verse = 'all';
  vp.value = String(S.verse);
  resetRun();
  applySongLayout();   // put this song's chords on the guitar's frets (if connected)
}
async function loadSongList() {
  try {
    const list = await (await fetch('songs/index.json', { cache: 'no-store' })).json();
    for (const e of list) {
      const f = typeof e === 'string' ? e : e.sheet;
      if (!f || store.get('deletedSongs', []).includes(f)) continue;   // deleted in Manage songs
      try {
        let s;
        if (typeof e === 'string') s = await (await fetch('songs/' + f, { cache: 'no-store' })).json();
        else {
          // a built-in song kept as a plain chord sheet (words added by a person); the index entry holds title, credit and band
          const text = await (await fetch('songs/' + f, { cache: 'no-store' })).text();
          s = importSongText(text, f).song;
          delete s.imported;
          if (e.swap) s.lines = s.lines.map(l => l.map(([c, w]) => [e.swap[c] || c, w]));   // simplify chords that aren't on a fret
          for (const k of ['title', 'artist', 'band', 'normalTempo', 'notes', 'credit']) if (e[k] != null) s[k] = e[k];
        }
        if (validSong(s)) S.songs.push({ id: f, song: s });
      } catch {}
    }
  } catch {}
  // songs you imported from chord sheets / lyrics files (kept in this browser)
  try { for (const x of savedImports()) if (validSong(x.song)) S.songs.push(x); } catch {}
  fillSongPicker();
  const want = store.get('song', null);
  const pick = S.songs.find(x => x.id === want) || S.songs[0];
  if (pick) { $('song-pick').value = pick.id; useSong(pick.song); }
  else $('now-sub').textContent = 'No songs found in the songs folder';
}
// ---------- song list: names, hiding, the song menu ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isUserSong = id => id.startsWith('import:') || id.startsWith('dropped:');
function songName(x) { return store.get('songNames', {})[x.id] || x.song.title; }
function fillSongPicker() {
  const cur = store.get('song', null);
  $('song-pick').innerHTML =
    S.songs.map(x => `<option value="${esc(x.id)}">${esc(songName(x))}</option>`).join('') +
    '<option disabled>──────────</option><option value="__add">📂 Add song…</option><option value="__manage">✏️ Manage songs…</option>';
  if (cur && S.songs.some(x => x.id === cur)) $('song-pick').value = cur;
}
// Manage songs: rename or delete any song.
function openManage() {
  $('mg-list').innerHTML = S.songs.map(x =>
    `<div class="mg-row" data-id="${esc(x.id)}">` +
    `<input class="mg-name" value="${esc(songName(x))}" title="Click to rename">` +
    '<button class="mg-del">Delete</button></div>').join('');
  $('manage-dlg').showModal();
}
function renameSong(id, name) {
  const x = S.songs.find(s => s.id === id); if (!x) return;
  name = name.trim();
  if (isUserSong(id)) { if (name) { x.song.title = name; if (id.startsWith('import:')) saveImport(id, x.song); } }
  else { const n = store.get('songNames', {}); if (name && name !== x.song.title) n[id] = name; else delete n[id]; store.set('songNames', n); }
}
$('mg-list').addEventListener('change', e => {
  if (e.target.classList.contains('mg-name')) renameSong(e.target.closest('.mg-row').dataset.id, e.target.value);
});
$('mg-list').addEventListener('click', e => {
  const row = e.target.closest('.mg-row'); if (!row) return;
  const id = row.dataset.id;
  if (e.target.classList.contains('mg-del')) {
    if (!e.target.classList.contains('armed')) { e.target.classList.add('armed'); e.target.textContent = 'Sure? Delete'; return; }
    if (isUserSong(id)) removeImport(id);
    else store.set('deletedSongs', [...new Set([...store.get('deletedSongs', []), id])]);   // built-in: never load it again
    S.songs = S.songs.filter(s => s.id !== id);
    row.remove();
    if (store.get('song') === id && S.songs.length) { store.set('song', S.songs[0].id); useSong(S.songs[0].song); }
  }
});
$('mg-done').onclick = () => $('manage-dlg').close();
$('mg-add').onclick = () => { $('manage-dlg').close(); $('add-song-file').click(); };
$('manage-dlg').addEventListener('close', () => { fillSongPicker(); renderAll(); });
// ⚙ Settings panel
$('settings-btn').onclick = e => { e.stopPropagation(); $('settings-panel').classList.toggle('hidden'); };
document.addEventListener('click', e => { if (!$('settings-grp').contains(e.target)) $('settings-panel').classList.add('hidden'); });

// ---------- UI wiring ----------
$('start').onclick = () => S.playing ? stop() : start();
$('restart').onclick = () => { resetRun(); };
$('listen').onclick = () => listen();
$('lights-btn').onclick = () => connectLights();
document.querySelectorAll('#mode-seg button').forEach(b => b.onclick = () => {
  S.mode = b.dataset.mode; store.set('mode', S.mode); resetRun();
});
$('app-ver').textContent = 'v' + APP_VERSION;
document.querySelectorAll('#sound-seg button').forEach(b => b.onclick = () => {
  S.sound = b.dataset.sound; store.set('sound', S.sound);
  if (S.sound !== 'guitar') loadSamples();
  if (L.ch && L.easy !== (S.sound !== 'finger')) { if (S.sound === 'finger') setEasyChord(false); else { L.programmed = null; applySongLayout(); } }
  renderAll();
});
// Browsers only allow sound after a click/key; load the Mac sound on the first one.
const unlock = () => { ensureAudio(); if (S.sound !== 'guitar') loadSamples(); };
window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
$('tempo').oninput = e => setTempo(+e.target.value);
$('spb').onchange = e => { S.spb = +e.target.value; store.set('spb', S.spb); resetRun(); };
$('click').onchange = e => { S.click = e.target.checked; store.set('click', S.click); };
$('chord-reset-btn').onclick = () => chordReset();
$('fret-layout').value = S.fretLayout;
$('fret-layout').onchange = e => { S.fretLayout = e.target.value; store.set('fretLayout', S.fretLayout); applySongLayout(); };
$('strum-level').value = S.strumLevel;
$('band').value = S.band;
$('band').onchange = e => { S.band = e.target.value; store.set('band', S.band); if (bandOn()) { loadSamples(); loadBass(); } renderControls(); };
$('band-lvl').value = S.bandLevel;
$('band-lvl').oninput = e => { S.bandLevel = +e.target.value; store.set('bandLevel', S.bandLevel); if (S.bandGain) S.bandGain.gain.value = S.bandLevel; };
$('strum-style').value = S.strumStyle;
$('strum-style').onchange = e => { S.strumStyle = e.target.value; store.set('strumStyle', S.strumStyle); S.stylePat = null; };
$('strum-level').onchange = e => { S.strumLevel = e.target.value; store.set('strumLevel', S.strumLevel); };
$('backing').onchange = e => { S.backing = e.target.checked; store.set('backing', S.backing); if (S.backing) loadSamples(); };
$('vol').value = S.volume;
$('voice-lvl').value = S.voiceLevel;
$('voice-lvl').oninput = e => { S.voiceLevel = +e.target.value; store.set('voiceLevel', S.voiceLevel);
  if (S.voxGain) S.voxGain.gain.value = S.voiceLevel; else if (S.vox) S.vox.volume = Math.min(1, S.voiceLevel); };
$('vol').oninput = e => { S.volume = +e.target.value; store.set('volume', S.volume); if (S.vol) S.vol.gain.value = S.volume; };
$('melody').onchange = e => { S.melodyOn = e.target.checked; store.set('melody', S.melodyOn); if (S.melodyOn) loadSamples(); };
$('vocals').onchange = e => { S.vocalsOn = e.target.checked; store.set('vocals', S.vocalsOn); if (S.vocalsOn) loadSamples(); renderControls(); };
$('verse-pick').onchange = e => { S.verse = e.target.value; store.set('verse', S.verse); resetRun(); };
$('song-pick').onchange = e => {
  const v = e.target.value;
  if (v === '__add') $('add-song-file').click();
  else if (v === '__manage') openManage();
  else { const x = S.songs.find(s => s.id === v); if (x) { store.set('song', x.id); useSong(x.song); } return; }
  e.target.value = store.get('song', S.songs[0]?.id);   // the menu goes back to showing the current song
};

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); S.playing ? stop() : start(); }
  else if (/^Digit[1-7]$/.test(e.code)) fakeStrum(+e.code.slice(5), e.shiftKey);
  else if (e.key === 'ArrowRight' && S.mode === 'follow') { S.pos = Math.min(S.slots.length - 1, S.pos + 1); renderAll(); }
  else if (e.key === 'ArrowLeft' && S.mode === 'follow') { S.pos = Math.max(0, S.pos - 1); S.slots[S.pos].res = null; renderAll(); }
});
// drag and drop a song file
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('drop').classList.remove('hidden'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.add('hidden'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('drop').classList.add('hidden');
  loadSongFiles(e.dataTransfer.files);
});
// 📂 Add song (from the song menu or Manage songs): pick a chord sheet / ChordPro / lyrics / song file
$('add-song-file').onchange = e => { loadSongFiles(e.target.files); e.target.value = ''; };
async function loadSongFiles(files) {
  for (const f of files) {
    if (/\.(pdf|png|jpe?g|gif|heic|gp\d?|mid|midi|mp3|m4a|wav)$/i.test(f.name)) {
      S.importReport = `“${f.name}” is not a text file. StrumAlong needs plain text (chords above words, ChordPro, or just the words).`;
      renderSetup(); showMsg('Not a text file', 1800); continue;
    }
    try {
      const text = await f.text();
      let s, id;
      if (/\.json$/i.test(f.name)) {
        s = JSON.parse(text);
        if (!validSong(s)) { showMsg('Not a song file', 1500); continue; }
        id = 'dropped:' + f.name;
      } else {
        // chord sheet / ChordPro / words-only text: convert it, and keep it for next time
        const r = importSongText(text, f.name);
        s = r.song; id = 'import:' + s.title; S.importReport = `Imported “${s.title}”: ${r.report}`;
        saveImport(id, s);
      }
      S.songs = S.songs.filter(x => x.id !== id); S.songs.push({ id, song: s });
      fillSongPicker(); $('song-pick').value = id; store.set('song', id); useSong(s);
      showMsg('Loaded', 1200);
    } catch (err) { showMsg('Could not read file', 1500); console.warn(err); S.importReport = 'Import failed: ' + err.message; renderSetup(); }
  }
}

renderControls();
loadSongList().then(() => { connectMIDI(); requestAnimationFrame(loop); });
