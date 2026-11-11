# Just Simple Excalidraw

Draw in Obsidian. Keep standard `.excalidraw` files.

## Use

```md
![[drawing.excalidraw]]
![[drawing.excalidraw|400]]
```

Click a preview to edit. It updates after a save.

Right-click a note: **Create new drawing and embed**.
Right-click a folder: **Create new drawing**.
Open a missing `.excalidraw` link to create it.

Previews hide in Source mode and while you edit their links.
They use the note's light or dark theme. No hover labels.

## Install

Back up your drawings. Copy the release files into:

```text
<vault>/.obsidian/plugins/just-simple-excalidraw/
```

Use `main.js`, `manifest.json`, and `styles.css`.
Restart Obsidian. Enable the plugin. Do not enable two Excalidraw editors.

## Files and limits

One drawing file. No image copies. No network requests.
One editor per drawing. External changes stop autosave.
A damaged file is not changed.

Large previews show an open button. Limits: 12 MiB per file, 5000 elements,
50000 points, and 32 images. Image data: 8 MiB total and 32 million pixels.
PNG, JPEG, GIF, and WebP are supported in previews. Other image types are
left unchanged in the drawing, but are not previewed.

Raw `.excalidraw` files only. No `.excalidraw.md` files or frame crops.
Previews use an internal Obsidian embed API. App updates can require a fix.

## Custom font

Set a vault font path in the plugin settings. Restart Obsidian.
Use WOFF2, WOFF, TTF, or OTF, up to 2 MiB. Clear the path to reset.
Other devices need the same font. The drawing does not contain the font.

## Build

Use Node.js 22.13 or later.

```sh
npm ci
npm run check
```

Output: `dist/`. Set `JSE_DEV_VAULT` only to install into a test vault.
See [DEVELOPMENT.md](DEVELOPMENT.md) for the preview code.

MIT license. Based on David Hurtado's Just Simple Excalidraw.
Uses [Excalidraw](https://excalidraw.com/). Not an official Excalidraw plugin.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled licenses.
