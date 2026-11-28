# Changelog

Version numbers: MAJOR.MINOR.PATCH. Bump PATCH for fixes, MINOR for new features, MAJOR for big changes.
The app shows its version next to its name; update `APP_VERSION` in `app.js` and this file together.

## 1.12.0 — November 2026
- **The Listener finds the beat by itself.** When it has heard a song, it works out the tempo from the recording (where the sound jumps, then the steady tick that fits those jumps best) and places every beat. Steady records get one tempo; records that speed up and slow down get a beat-by-beat timing map, so the chart follows the band. **×2** and **÷2** fix a tempo heard at half or double speed. Tapping is still there and, if you tap, your taps win.
- It analyses the artist's recording once, to build the song file; nothing listens to or scores the player.

## 1.11.0 — November 2026
- **Three more 🎸 Rock Out songs:** **Let It Be** (The Beatles), **Against the Wind** (Bob Seger & The Silver Bullet Band) and **You Belong With Me** (Taylor Swift). Each plays the artist's own YouTube upload; Against the Wind uses Bob Seger's official lyric video, so the words are on screen in the artist's own video. As always, StrumAlong ships only chord names and their timing.
- **Rock Out follows records that speed up and slow down.** A Rock Out song can now carry a beat-by-beat timing map, so the chords stay with bands that played without a click track (Let It Be drifts from about 72 to 68 BPM). Add-on only: songs without a map work exactly as before.
- **Code Monkey removed** from the built-in songs.
- README: new section, **Rock Out: rights and permissions, in plain English**.

## 1.10.1 — November 2026
- Words only: StrumAlong now introduces itself as a free play-along app for **anyone learning guitar or keyboard**, and for players who want to practise along with the music they love: made for the AeroBand guitar (all of its AeroBand features stay), now for any guitar, keyboard or ukulele. README, page title, and all four guides updated, plus why it exists: a project to help more people make music, for the good of all.

## 1.10.0 — November 2026
- **🎤 Any instrument (experimental): StrumAlong is now for everyone.** A new button next to 💡 Connect. Turn it on, play a regular guitar, keyboard, ukulele or piano near the computer, and StrumAlong hears the chord you play through the microphone. Each new strum or key press counts like a strum on the AeroBand, so Follow me, Fixed tempo and Free play all work. It finds the notes sounding (removing each note's overtones, so a guitar's open C isn't mistaken for Em) and judges the chord about a quarter-second after you play. A live level bar shows what it hears.
- While it's on, the computer's own strum is silent (your instrument makes the sound); your Sound choice comes back when you turn it off, and is never overwritten. Nothing else changes: with it off, StrumAlong works exactly as before.
- Nothing is recorded: the sound is analysed live and thrown away (see PRIVACY.md).

## 1.9.3 — November 2026
- **Privacy & Terms:** new `PRIVACY.md` (what StrumAlong keeps, what YouTube and other services see), linked from the README.
- Rock Out songs and the Listener now say that they use YouTube's player, with links to the YouTube Terms of Service and the privacy page, as YouTube's developer policies ask.

## 1.9.2 — November 2026
- The play-along-with-the-record feature is now simply called **🎸 Rock Out**. It works the same way: it plays the artist's official video on YouTube, through YouTube's standard player, and StrumAlong adds the chords. Song menu: 🎧 Make a Rock Out song….

## 1.9.1 — November 2026
- **Listener: fix any chord.** Clicking a chord in the chart now opens a picker: the song's chords first, then every major and minor chord, so you can put in a chord the Listener missed altogether.
- **Listener: better at telling twin chords apart.** A chord is no longer dropped as a "ghost" when its own root is clearly in the bass (e.g. C over a C bass is kept even though it shares two notes with Em).
- The tempo readout is rounded when a Rock Out song is slowed down (it could show 90.07499… BPM).

## 1.9.0 — November 2026
- **🎧 StrumAlong Listener:** make your own Rock Out songs. It plays the official video, listens through the microphone (nothing is recorded: it keeps a 12-number pitch summary every 0.1 s and only chord names and times end up in the song), you tap the beat for 15 seconds, and it works out the chart: the song's main chords (up to 7, near-twin "ghost" chords like Am-for-C are dropped), two per bar, lined up with the record. Click a chord to fix it; ➕ Add to StrumAlong puts it straight into your song list, 💾 Save song file makes a file to share. Open it from the song menu (🎧 Make a Rock Out song…) or at `listener/`.
- **New song: Sweet Home Alabama** (Lynyrd Skynyrd), with the official audio: D – C – G on frets 1–3.
- Rock Out songs always put the song's own chords on the frets (whatever the Fret layout setting), since the record decides the chords.
- Song files added with 📂 Add song… (.json, e.g. a shared Rock Out song) now stay in your song list.
- New guide: `docs/StrumAlong-Rock-Out-Guide.pdf`.

## 1.8.0 — November 2026
- **🎸 Rock Out:** songs can now play along with an official YouTube video. The video is the music; the song clock follows the video's own time, so the lit frets and chord chart stay in sync, and the Tempo slider sets the video's speed (YouTube's 0.75× / 0.5× steps).
- **New song: Summer of '69** (Bryan Adams), with the official video. Seven chords: D, A, Bm, G and the bridge's F, B♭, C.
- Song files can carry `"youtube": {"id", "start"}`; `start` is where beat 0 of the chord chart falls in the video.
- With a video song the computer doesn't strum or play the band over the record. Follow me isn't available yet for video songs (use ▶ Listen or Fixed tempo).

## 1.7.0 — November 2026
- **New song: Code Monkey** by Jonathan Coulton (Creative Commons BY-NC 3.0), with the Rock band. It's a song you sing yourself: words on screen, no AI singer. Four easy chords (C, F, G, Am).
- Built-in songs can now be plain chord sheets (`.txt`): list them in `songs/index.json` as `{"sheet": "file.txt", "title", "band", "credit", ...}`.
- A song's credit line now shows under the words.

## 1.6.0 — November 2026
- **Jam with the band:** drums and bass now play along behind the guitar, so the chords don't sound empty. Pick the style in ⚙ Settings → **Band**: Song style (each song picks its own), Folk (brushes), Country (train beat), Rock or Off. The new **Band** slider sets drums and bass against the guitar.
- The band plays in Listen and Fixed tempo and follows the Tempo slider; the bass follows the chords and walks into the next one. In Follow me (no clock) each good strum gets a bass note and a drum hit instead.
- Drums are made in the browser; the bass is the FluidR3 acoustic bass (same free sound set as the guitar).

## 1.5.0 — November 2026
- **Every built-in song is now sung:** Oh My Darling, Clementine; Oh! Susanna; Yankee Doodle and I've Been Working on the Railroad join Kumbaya (same free AI singer, TIGER DS, made with OpenUtau). Tick **Vocals** in Settings and press Listen or Fixed tempo.
- I've Been Working on the Railroad now has its melody (the traditional tune, all the way through Dinah, the kitchen and fee-fi), so Melody mode plays it too. Its Dinah and kitchen lines are regrouped so the words show when they are sung.

## 1.4.0 — November 2026
- **Hear it sung:** Kumbaya now has a sung vocal (TIGER DS, a free AI singer, made with OpenUtau). Tick **Vocals** in Settings: the singer sings along in Listen and Fixed tempo, follows the Tempo slider without changing pitch, and jumps to the verse you pick. It replaces the Melody tune while it sings; it stays off in Follow me.
- New **Voice** slider (next to Vol, on songs with a singer) to balance the singer against the guitar.
- The Tempo slider now goes up to 150% of a song's normal speed.
- Kumbaya's normal speed is now 120 BPM (it was 88, which felt slow).

## 1.3.1 — November 2026
- The hosted site now keeps an anonymous visit count with GoatCounter (no cookies, nothing personal), so we can tell whether anyone uses it. Copies run from your own computer are not counted.

## 1.3.0 — November 2026
- New **Strum style** (Settings, for Computer sound): you strum once per block and the computer plays a pattern: Plain strum, Boom-chuck, Fingerpick or Arpeggio. It keeps to the song's tempo in Fixed tempo and to your own pace in Follow me; strumming harder plays louder.
- Guides now say plainly: iPhone and iPad can't work (any browser); Android is untested.
- Up-strum trick: strum up instead of down and the pattern ends with a bass walk into the next chord (e.g. G, A, B into C).

## 1.2.3 — November 2026
- Chord chart arrows now match what you play: in Follow me each block shows the one strum it waits for, and Easy is one down-strum per block (it follows Strums per bar). Found in a first-time-user test.

## 1.2.2 — November 2026
- Sound now follows your computer's output choice (speakers, headphones, AirPods). Only if the computer switches its output to the guitar does StrumAlong send its sound to the built-in speakers instead. Previously headphones were ignored.

## 1.2.1 — November 2026
- Chord reset made reliable: sends the factory layout twice and waits 2 seconds before disconnecting, so the guitar saves it (verified on a real guitar through a power cycle)

## 1.2.0 — November 2026
- New **↺ Chord reset & disconnect** (Settings, or click **💡 Connected**): puts back the factory chords (C Dm Em F G Am Bdim), Easy Chord on and the guitar's own light colours, then disconnects. Needed because the song's chord layout stays on the guitar after it is switched off.

## 1.1.2 — November 2026
- Project moved to its permanent home: https://github.com/strumalong9779/StrumAlong (web app: https://strumalong9779.github.io/StrumAlong/)

## 1.1.1 — November 2026
- New users now hear the clean strum from the computer straight away (Sound starts on **Computer** instead of Guitar)
- README and guides now include the real web link

## 1.1.0 — November 2026
First public release.
- Follow me, Fixed tempo and Free play modes; Listen, Backing, Melody and Click
- Sound: Computer (perfect strum), Natural, Guitar and Silent
- Connects to the guitar over Bluetooth: Classic mode, fret lights, per-song Easy Chord layout (Song chords or Full key)
- Strum direction and scoring; strum patterns Easy / Medium / Full
- Add songs from chord sheets, ChordPro or lyrics; rename and delete songs
- Five built-in public-domain songs
- Quick Start, User Guide and Technical Guide (docs/)

## 1.0.0 — November 2026 (private)
The first working version, built for the author's own guitar: Follow me play-along for Kumbaya, chord recognition
from the guitar's MIDI, fret lights over Bluetooth, and an on-screen chord chart. Debugged and extended into 1.1.0.
