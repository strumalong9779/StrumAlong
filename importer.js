// StrumAlong song importer: turns a text file you drop on the window into a playable song.
// Understands three kinds of text:
//   1. Chord sheets   - chords on their own line above the words (Ultimate Guitar style)
//   2. ChordPro       - chords inline in brackets: "[G]Some words [C]more words", {title: ...}
//   3. Words only     - no chords: the words are laid onto the song that is loaded right now
// Songs are moved into C and chords simplified (G7 -> G, Am7 -> Am) so they land on the
// seven Easy Chord frets. Imported songs are kept in this browser (localStorage).
'use strict';

const IMPORT_EC = { 1: 'C', 2: 'Dm', 3: 'Em', 4: 'F', 5: 'G', 6: 'Am', 7: 'Bdim' };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHORD_RE = /^\(?([A-G])([#b]?)(maj|min|m|dim|aug|sus|add|M|°|\+)?(\d*)((?:sus\d|add\d|b\d+|#\d+|maj\d+)*)(\/[A-G][#b]?)?\)?$/;
const NOISE_RE = /^(\||-+|x\d+|\d+x|%|N\.?C\.?|\(?x\d\)?|\.\.\.)$/i;

function parseChord(tok) {
  const m = CHORD_RE.exec(tok.trim()); if (!m) return null;
  let root = ROOTS[m[1] + m[2]]; if (root == null) return null;
  const q = m[3] || '';
  const quality = (q === 'm' || q === 'min') ? 'm' : (q === 'dim' || q === '°') ? 'dim' : '';
  return { root, quality };
}
const chordName = c => SHARP[((c.root % 12) + 12) % 12] + c.quality;
const isChordLine = line => {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  const real = toks.filter(t => !NOISE_RE.test(t));
  return real.length > 0 && real.every(t => parseChord(t));
};
const isTabLine = line => /^[eBGDAE]?\s*\|?[-0-9hpb/\\|~x]{6,}/.test(line.trim());
const headerOf = line => {
  const t = line.trim();
  let m = /^\[([^\]]{1,30})\]$/.exec(t) || /^\{(?:c|comment|soc|start_of_chorus|sov|start_of_verse)(?::\s*([^}]*))?\}$/i.exec(t);
  if (m) return (m[1] || (/soc|chorus/i.test(t) ? 'Chorus' : 'Verse')).trim();
  m = /^(intro|verse|chorus|bridge|outro|pre-?chorus|refrain|solo|interlude|instrumental)\b[^:]{0,12}:?$/i.exec(t);
  return m ? t.replace(/:$/, '') : null;
};

// ---- parse the text into lines of cells: [{chord, words}] ----
function parseText(text) {
  const raw = text.replace(/\r/g, '').split('\n');
  let title = null, artist = null;
  const out = [];   // { label?, cells: [{chord, words}] } per lyric line
  let label = null, lastChord = null;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].replace(/\t/g, '    ');
    const t = line.trim();
    let m;
    if ((m = /^\{(?:title|t):\s*([^}]*)\}$/i.exec(t))) { title = m[1].trim(); continue; }
    if ((m = /^\{(?:artist|subtitle|st):\s*([^}]*)\}$/i.exec(t))) { artist = m[1].trim(); continue; }
    if (/^\{(eoc|end_of_chorus|eov|end_of_verse)\}$/i.test(t)) { label = null; continue; }
    if (/^\{[^}]*\}$/.test(t)) { const h = headerOf(t); if (h) label = h; continue; }
    if (!t) { continue; }
    // Chord-site clutter: "Tom: G", "Key: C", "Capo: 2", "Tuning: ...", "Difficulty: ..." etc.
    if (/^(tom|key|capo|tuning|difficulty|author|artist|tabbed by|chords by|transcribed by|strumming|bpm|tempo|album|year|rating|tags?)\s*:/i.test(t)) {
      if ((m = /^artist\s*:\s*(.+)$/i.exec(t))) artist = artist || m[1].trim();
      continue;
    }
    // "Artist - Title (Chords)" heading, as Ultimate Guitar files start
    if (!out.length && (m = /^(.+?)\s+[-–]\s+(.+?)\s*\((?:chords|tab|ukulele chords|chords & lyrics)\)\s*$/i.exec(t))) {
      artist = artist || m[1].trim(); title = title || m[2].trim(); continue;
    }
    if (/^\[(?:\/?ch|\/?tab)\]$/i.test(t)) continue;
    const h = headerOf(t); if (h) { label = h; continue; }
    if (isTabLine(line)) continue;
    // ChordPro inline chords: "[G]Some words [C]more"
    if (/\[[A-G][^\]]*\]/.test(line) && !isChordLine(line)) {
      const cells = []; const re = /\[([^\]]+)\]/g; let pos = 0, cur = lastChord, mm, pre = '';
      while ((mm = re.exec(line))) {
        const words = line.slice(pos, mm.index);
        if (cells.length) cells[cells.length - 1].words += words; else pre += words;
        const c = parseChord(mm[1]); if (c) { cur = c; cells.push({ chord: c, words: '' }); }
        pos = mm.index + mm[0].length;
      }
      const tail = line.slice(pos);
      if (cells.length) cells[cells.length - 1].words += tail; else pre += tail;
      if (pre.trim()) cells.unshift({ chord: lastChord || cur, words: pre });
      if (cells.length) { out.push({ label, cells }); label = null; lastChord = cur; }
      continue;
    }
    // Chord line above a lyric line
    if (isChordLine(line)) {
      const chords = []; const re = /\S+/g; let mm;
      while ((mm = re.exec(line))) { const c = parseChord(mm[0]); if (c) chords.push({ col: mm.index, chord: c }); }
      const next = raw[i + 1] != null ? raw[i + 1].replace(/\t/g, '    ') : '';
      const nextIsLyric = next.trim() && !isChordLine(next) && !headerOf(next) && !isTabLine(next);
      const cells = [];
      if (nextIsLyric) {
        i++;
        if (chords[0].col > 0 && next.slice(0, chords[0].col).trim())
          cells.push({ chord: lastChord || chords[0].chord, words: next.slice(0, chords[0].col) });
        chords.forEach((c, k) => {
          let a = c.col, b = k + 1 < chords.length ? chords[k + 1].col : next.length;
          // don't cut a word in half: move the cut to the start of the word it falls in
          while (a > 0 && a < next.length && /\S/.test(next[a - 1]) && /\S/.test(next[a])) a--;
          while (k + 1 < chords.length && b > 0 && b < next.length && /\S/.test(next[b - 1]) && /\S/.test(next[b])) b--;
          cells.push({ chord: c.chord, words: next.slice(a, Math.max(a, b)) });
        });
      } else chords.forEach(c => cells.push({ chord: c.chord, words: '' }));   // instrumental bar(s)
      out.push({ label, cells }); label = null; lastChord = chords[chords.length - 1].chord;
      continue;
    }
    // A plain first line followed by a section header or chord line is the song's title.
    if (!title && !out.length) {
      let j = i + 1; while (j < raw.length && !raw[j].trim()) j++;
      const nx = raw[j] || '';
      if (headerOf(nx) || isChordLine(nx) || /^\{/.test(nx.trim())) { title = t; continue; }
    }
    // Plain lyric line (no chords)
    out.push({ label, cells: [{ chord: null, words: line }] }); label = null;
  }
  return { title, artist, lines: out };
}

// Choose the shift that puts the most chords on the Easy Chord frets (prefers no shift on a tie).
function bestShift(lines) {
  const frets = new Set(Object.values(IMPORT_EC)), counts = {};
  lines.forEach(l => l.cells.forEach(c => { if (c.chord) { const k = c.chord.root + '|' + c.chord.quality; counts[k] = (counts[k] || 0) + 1; } }));
  let best = 0, bestScore = -1;
  for (let s = 0; s < 12; s++) {
    let sc = 0;
    for (const [k, n] of Object.entries(counts)) { const [r, q] = k.split('|'); if (frets.has(chordName({ root: (+r + s) % 12, quality: q }))) sc += n; }
    if (sc > bestScore + (s === 0 ? -1 : 0)) { bestScore = sc; best = s; }
  }
  return best;
}

const clean = w => w.replace(/\s+/g, ' ').trim();

// ---- build a StrumAlong song ----
function importSongText(text, fileName) {
  const p = parseText(text);
  const hasChords = p.lines.some(l => l.cells.some(c => c.chord));
  const baseTitle = p.title || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported song';
  if (!hasChords) return importWordsOnly(p, baseTitle);
  const shift = bestShift(p.lines);
  const name = c => c ? chordName({ root: (c.root + shift) % 12, quality: c.quality }) : null;
  let carry = 'C';
  const lines = p.lines.map(l => {
    const cells = l.cells.map(c => { const ch = name(c.chord) || carry; carry = ch; return [ch, clean(c.words)]; });
    if (l.label && cells.length) cells[0][1] = `⟨${l.label}⟩ ` + cells[0][1];
    return cells;
  }).filter(cells => cells.length);
  const used = [...new Set(lines.flat().map(c => c[0]))];
  const off = used.filter(c => !Object.values(IMPORT_EC).includes(c));
  const orig = SHARP[0], moved = shift ? `moved into C (from ${SHARP[(12 - shift) % 12]})` : 'in C';
  return {
    song: {
      title: baseTitle, artist: (p.artist ? p.artist + ' · ' : '') + 'imported', key: 'C',
      beatsPerBar: 4, cellBeats: 4, normalTempo: 90, easyChord: IMPORT_EC, imported: true,
      notes: `Imported from ${fileName}: each chord change is one bar. ${moved}; chords simplified to plain triads.`,
      lines, verses: [{ name: 'Whole song' }],
    },
    report: `${lines.length} lines · ${moved}` + (off.length ? ` · not on a fret: ${off.join(', ')}` : ''),
  };
}

// Words only: lay the lines onto the loaded song's chord lines, in order.
function importWordsOnly(p, baseTitle) {
  if (!S.song) throw new Error('Load the song first, then drop the words');
  const src = S.song, words = p.lines.map(l => ({ label: l.label, text: clean(l.cells[0].words) })).filter(w => w.text);
  const lines = words.map((w, i) => {
    const tmpl = src.lines[i % src.lines.length];
    // put the words in the bars where the song's own words sit (else all in the first bar)
    let slots = tmpl.map((c, k) => (c[1] ? k : -1)).filter(k => k >= 0);
    if (!slots.length) slots = [0];
    const ws = w.text.split(' '), per = Math.ceil(ws.length / slots.length);
    const cells = tmpl.map(([ch]) => [ch, '']);
    slots.forEach((k, j) => { cells[k][1] = ws.slice(j * per, (j + 1) * per).join(' '); });
    if (w.label) cells[0][1] = `⟨${w.label}⟩ ` + cells[0][1];
    return cells;
  });
  const title = src.title.replace(/\s*\(chords only\)\s*/i, '') + ' (with your words)';
  return {
    song: { ...src, title, imported: true, lines, verses: [{ name: 'Whole song' }], melody: undefined, melodyStart: undefined,
            notes: `Your words laid onto ${src.title}'s chords, line by line.` },
    report: `${lines.length} lines of words on ${src.title}'s chords`,
  };
}

// ---- keep imported songs in this browser ----
function savedImports() { return store.get('importedSongs', []); }
function saveImport(id, song) {
  const all = savedImports().filter(x => x.id !== id); all.push({ id, song });
  store.set('importedSongs', all);
}
function removeImport(id) { store.set('importedSongs', savedImports().filter(x => x.id !== id)); }
window.removeImport = removeImport;
