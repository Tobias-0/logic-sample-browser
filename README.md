# Sample Browser

A small desktop app for browsing a WAV sample library by **BPM**, **note** and **style**,
and dragging the result straight into Logic Pro X.

It reads metadata out of the file names and WAV headers — nothing is moved, renamed
or written into your library.

## Run it

```bash
npm start
```

On first launch it scans the library and caches the index, so later launches open
instantly. **Rescan** re-reads the folder after you add new packs.

The **settings** button (top right) holds appearance and the library folder.

Default library path: `~/Music/Logic/Splice/sounds/packs`

## Dragging into Logic

Drag any row straight onto a Logic track. This is a real macOS file drag — Logic
receives the actual file from your library, exactly as if you had dragged it out of
Finder. Select several rows first (⌘-click or ⇧-click) to drag them as a group.

## Appearance

Settings → Appearance switches between **System**, **Light** and **Dark**. The choice is
remembered between launches. On System the window follows macOS and flips live when
you change the OS setting — no restart, no reopening the panel.

The palette is one accent plus a neutral ramp. `--accent` is per-theme, because no
single value is both vivid on near-black and legible on white — a bright lime scores
15:1 on the dark background but 1.21:1 on the light one, where it vanishes:

| | accent | on its background | on its surface |
| --- | --- | --- | --- |
| Dark | `#C6F24E` lime | 15.2:1 | 14.2:1 |
| Light | `#43700A` deep lime | 5.9:1 | 5.5:1 |

Each theme uses its one accent for both fills and text, so nothing needs a second
accent token. `--on-accent` is whatever reads on top of that fill — near-black on
lime, white on deep lime.

## Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` | Move through results (auto-previews) |
| `Space` | Play / pause |
| `F` | Favourite the selected sample |
| `Enter` | Reveal in Finder |
| `⌘F` | Jump to search |
| `Esc` | Close the settings panel |
| double-click | Reveal in Finder |

## What it reads

| Field | Where it comes from |
| --- | --- |
| BPM | `128bpm`, `_128_`, `drm124` in the name or folder, cross-checked against the clip length so a tempo that doesn't divide into whole bars is rejected. A `~` prefix means it was estimated from length alone. |
| Note / scale | `Gmin`, `F#m`, `A_maj`, `Db`, `G5`, or a bare note after the tempo (`126bpm_C`). Flats are normalised to sharps, so `Gbmin` files show up under `F#`. |
| Style | Matched against the name, then the containing folders, then the pack name — kick, snare, hat, bass, pad, vocal and so on. |
| Loop / one-shot | The name or folder if it says so, otherwise clip length. |
| Length, rate, bit depth | Read from the WAV header. |

Filters combine, and each facet's counts reflect the *other* active filters, so you can
see what narrowing further would leave you. Options you've selected stay pinned to the
top of their list.

## Files

| File | Purpose |
| --- | --- |
| `scan.js` | Walks the library, parses names, reads WAV headers |
| `main.js` | Electron main process — window, scan cache, native file drag |
| `preload.js` | The bridge exposed to the interface |
| `renderer/` | The interface |

## Working on the interface

`renderer/dev-stub.js` lets the interface run in a plain browser against a dumped
index, so you can iterate on layout without launching Electron:

```bash
npm run reindex && npx http-server renderer -p 4321 -c-1
```

Under Electron the stub sees the real `window.api` and does nothing.

## Licence

The app is MIT licensed — see [LICENSE](LICENSE).

It bundles the [Inter](https://rsms.me/inter/) typeface, which is licensed
separately under the SIL Open Font License 1.1. That licence is included at
[`renderer/fonts/Inter-OFL.txt`](renderer/fonts/Inter-OFL.txt) and applies to
`renderer/fonts/inter.woff2` only.
