# StrumAlong

**Version 1.5.0** (November 2026) · see `CHANGELOG.md`

*Unofficial project, free and as-is: use at your own risk. See the [Disclaimer](#disclaimer) at the bottom.*

**If you're learning guitar, just starting out, or just want to make some music, StrumAlong is here.** It's a free, open-source companion app for the **AeroBand smart guitar** (also called the Aero Guitar) that gets you playing real songs from your very first strum. It lights the fret to press for each chord, shows the chords and words big on your computer screen, and **waits for you**: the song only moves on when you strum, so you learn at your own pace. Already play? It works for you too. Runs in Google Chrome on a Mac or Windows computer.

![StrumAlong playing Kumbaya: the chord to play now, the scrolling chord chart and the words, with the new Voice slider, Strum styles and Vocals highlighted](docs/screenshot.png)

- No install, no drivers, no AeroBand phone app needed.
- Works with the guitar over Bluetooth, straight from the browser.
- Bring your own songs: drop a chord sheet (text or ChordPro) on the window.
- **Hear it sung:** every built-in song (Kumbaya, Clementine, Oh! Susanna, Yankee Doodle and I've Been Working on the Railroad) comes with a sung vocal (an AI singer) that sings along with the chords in Listen and Fixed tempo, so you can hear how the words fit the strums. A **Voice** slider sets the singer against the guitar.

**Guides:** `docs/StrumAlong-Quick-Start.pdf` (first use, 2 pages), `docs/StrumAlong-User-Guide.pdf` (how to play) and `docs/StrumAlong-Technical-Guide.pdf` (how it works, how to change it).

## Quick start

1. Use an **up-to-date Google Chrome** on a Mac or Windows computer with Bluetooth (in Chrome: menu → Help → About Google Chrome updates it). StrumAlong was built and tested in Chrome. Microsoft **Edge** uses the same engine and should work, but is untested. (Safari and Firefox can't talk to Bluetooth devices.) **Not iPhone or iPad**, in any browser: Apple's browser engine can't reach Bluetooth devices. **Android** tablets with Chrome: untested.
2. Open the app:
   - **Just use it (most people):** the app is hosted online by GitHub and runs in Chrome. Nothing to install. **[Open StrumAlong →](https://strumalong9779.github.io/StrumAlong/)**
   - **Want the source code, or to run it on your own computer?** Download the full package (`StrumAlong-x.y.z.zip`) from the **[latest release](https://github.com/strumalong9779/StrumAlong/releases/latest)** and unzip it. Then on a Mac double-click `Start StrumAlong (Mac).command` (the first time, right-click it and choose Open); on Windows double-click `Start StrumAlong (Windows).bat` (needs Python from python.org). These start a small local server, because browsers only allow Bluetooth on `https://` or `http://localhost` pages; just double-clicking `index.html` won't work.
3. Turn the guitar on, close the AeroBand phone app, click **💡 Connect**, pick the guitar in the list.
   - ⚠️ **Don't pair the guitar in your computer's Bluetooth settings.** Connect only with StrumAlong's **💡 Connect** button: Chrome has its own Bluetooth link to the guitar, separate from your Mac's or PC's Bluetooth menu, and the **Pair** button in Chrome's pop-up list is the right one. If System Settings → Bluetooth (Mac) or Settings → Bluetooth & devices (Windows) shows the guitar as **connected**, **disconnect** it there first. No need to remove or forget it.
4. Choose a song, press **Start**, strum.
5. **Done?** Click **💡 Connected** (or Settings → ↺ Chord reset & disconnect) to put the guitar back the way it came.

**Sound:** normally the sound comes out of the **computer**, not the guitar: choose **Computer** (a clean strum of the chord you meant) or **Natural** (exactly what you play), and turn the guitar's volume knob down. **Guitar** uses the guitar's own speaker; **Silent** plays nothing. The user guide explains each one.

**Strum style:** with Computer sound, pick **Fingerpick**, **Boom-chuck** or **Arpeggio** in Settings: you strum once per block and the computer plays the pattern. Strum up instead of down for a bass walk into the next chord.

**Privacy:** no accounts, no cookies. The hosted site keeps an anonymous visit count (GoatCounter) so we know whether anyone uses it; nothing you play is sent anywhere, and copies run from your own computer aren't counted.

## Credits

- Written with **Claude Opus 5.5** (Anthropic's AI), at the direction of, and tested by, the project's human author.
- Guitar sound: FluidR3_GM soundfont by Frank Wen, CC BY 3.0, served by gleitz/midi-js-soundfonts.
- Built-in songs are traditional, public-domain tunes.
- The song vocals are sung by **TIGER DS**, a free AI singing voice by tigermeat (licence CC BY-NC-ND 4.0 with Commons Clause: free for non-commercial use), rendered with **OpenUtau** (free, MIT licence). The vocal recordings (`songs/vocals/*.mp3`) are not covered by StrumAlong's MIT licence: share them only non-commercially, with this credit.

## Not affiliated

StrumAlong is an independent project. It is not made by, endorsed by or affiliated with AeroBand
or Anthropic. "AeroBand" is a trademark of its owner. The app talks to the guitar using commands
observed from the guitar's own Bluetooth traffic, for interoperability; use at your own risk.

## Why it exists, and contributing

We think the AeroBand guitar is a great product. StrumAlong is meant to enhance it, not compete with it: a big-screen way to
learn and play that we hope brings more people to the guitar.

Contributions are welcome: open an **Issue** for bugs and ideas, or send a **pull request** with fixes, features or
public-domain songs. For guitar commands, only use ones seen from the official app, and test one change at a time.

License: MIT (see `LICENSE`).

## Disclaimer

> StrumAlong is an independent, unofficial project. It is not made, endorsed, supported or approved by AeroBand or Anthropic.
> It is provided free and "as is", without warranty of any kind. It does not change the guitar's firmware, but it does change guitar settings
> (mode, lights, Easy Chord layout). **Use it entirely at your own risk**; the authors accept no liability for any damage, malfunction,
> voided warranty or other problem. These settings stay on the guitar after it is switched off; StrumAlong's **Chord reset** button (or the official AeroBand app) puts them back. "AeroBand" is a trademark of its owner,
> used only to say which guitar this works with. **By using StrumAlong, you agree to these terms.** If you don't agree, don't use it.

## Visits

![Visits to the StrumAlong site](https://strumalong.goatcounter.com/counter/TOTAL.svg)

*Total visits to the hosted app ([strumalong9779.github.io/StrumAlong](https://strumalong9779.github.io/StrumAlong/)), counted anonymously by GoatCounter; updates every few hours.*
