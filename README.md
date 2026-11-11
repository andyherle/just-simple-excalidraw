> **0.1.12 test build:** Show drawings in notes. Live testing is still needed.
> See [release notes](RELEASE_NOTES.md) for test steps.

> **Fixed in v0.1.7:** earlier versions could overwrite a drawing when switching
> files in the same tab. Update to this version, and back up your `.excalidraw`
> files before upgrading as a precaution.

> **Changed in v0.1.8:** reopening an already open drawing focuses its existing
> tab instead of creating a second editor. Obsidian's **Split right** and
> **Split down** commands are native pane actions; when used on a drawing, the
> temporary duplicate pane closes again to keep a single editor for the file.

> **New in v0.1.9:** Just Simple Excalidraw is available on Obsidian mobile,
> with the same local-first drawing files and autosave behavior as desktop.

# Just Simple Excalidraw

> **Fixed in v0.1.10:** removed an unused upstream Firebase configuration and
> Google API key from the bundled editor to avoid secret-scanner alerts.

An intentionally small, local-first [Excalidraw](https://excalidraw.com/) editor
for Obsidian that preserves the original's brilliant simplicity. It edits
portable `.excalidraw` JSON files directly in the vault.

![Just Simple Excalidraw running in Obsidian](assets/just-simple-excalidraw-screenshot.png)

## Why this plugin exists

Excalidraw is brilliant because it makes drawing feel immediate. Open a canvas,
think with your hands, and get out of the way. Just Simple Excalidraw brings
that essential experience to an offline Obsidian vault without turning it into
another complex workspace.

The excellent [Obsidian Excalidraw plugin by zsviczian](https://github.com/zsviczian/obsidian-excalidraw-plugin)
offers extensive integrations and a large feature set for people who need them.
This plugin has a deliberately different goal: no feature race, no extra
workflow layer, and no attempt to reproduce hundreds of options. It is for
people who want the original, focused Excalidraw canvas inside Obsidian.

If Excalidraw is an important part of your work, please consider supporting the
upstream team with [Excalidraw+](https://plus.excalidraw.com/). This plugin uses
the open-source editor locally; Excalidraw+ helps sustain the product and adds
online services for users who need them. If you need the advanced features this
plugin intentionally leaves out, Excalidraw+ is the better fit—and directly
supports the people building Excalidraw.

## What it does

- Creates and opens native `.excalidraw` drawings from the command palette or
  the ribbon.
- Runs on Obsidian desktop, phones, and tablets.
- Uses the official Excalidraw editor with its standard drawing tools.
- Saves automatically after a short pause and writes images into the drawing as
  embedded data, so a drawing stays self-contained.
- Stops autosave if its file changes outside the open editor, avoiding silent
  overwrites.
- Reports malformed drawings without changing the original file.
- Follows Obsidian's light and dark theme.
- Shows `.excalidraw` drawings in notes.
- Creates and embeds drawings from notes.
- Creates drawings from missing `.excalidraw` links.

It does not include OCR, AI, collaboration, cloud sync, a drawing library,
accounts, or export tools. Mermaid conversion and web embeds are also excluded.

## Lean build and Obsidian Sync

Community Plugins installs `main.js`, `manifest.json`, and `styles.css` from a
GitHub release. Since Obsidian Sync Standard cannot sync a plugin file larger
than 5 MB, this plugin keeps its release `main.js` below that limit.

That constraint is intentional: Just Simple Excalidraw ships a focused editor,
not every optional Excalidraw subsystem. It includes one embedded Excalifont
subset covering Latin characters, including Spanish accents. Other scripts and
the optional Excalidraw font variants fall back to fonts available on the local
system. No font or code is downloaded at runtime.

### What this trade-off means

To remain small, local, and Sync-friendly, the plugin does not include
Mermaid-to-Excalidraw conversion, online collaboration, cloud services, an
account, a library, advanced integrations, or the full set of optional fonts.
It is intended for focused, offline drawing inside a vault. If those advanced
capabilities matter to your workflow, use
[Excalidraw+](https://plus.excalidraw.com/): it provides the online service
layer and helps fund ongoing Excalidraw development.

## Privacy and permissions

Just Simple Excalidraw is local-first by design.

- **Network:** it makes no runtime network requests. Its one bundled Latin font
  subset and all editor code are included in the release.
- **Vault files:** it reads drawings you open or embed. It saves drawings you
  create or edit. A note changes only when you create and embed a drawing.
- **Clipboard:** standard copy and paste actions, including pasting an image,
  run only after you invoke them. The plugin does not read the clipboard in the
  background.
- **Files outside the vault:** only an image explicitly chosen or pasted by you
  can be read; it is embedded into the active drawing. Images over 10 MiB are
  rejected.
- **Browser storage:** the plugin itself does not persist vault data in
  `localStorage` or `sessionStorage`; the drawing file in your vault is the
  source of truth. The bundled upstream Excalidraw runtime contains browser
  storage support for its own optional editor state.
- **Telemetry, ads, accounts and payments:** none.

## Installation

### Community Plugins

Once accepted into the Obsidian Community directory, install it from
**Settings → Community plugins** and enable it.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub
release. Put those three files in:

```text
<vault>/.obsidian/plugins/just-simple-excalidraw/
```

Then enable **Just Simple Excalidraw** in Obsidian.

## Use

Run **Create new Excalidraw drawing** from the command palette, or use the
pencil ruler icon in the ribbon. The new file is created in the vault root
using a timestamped `Drawing YYYY-MM-DD HH.MM.SS.excalidraw` name.

### Drawings in notes

Add `![[drawing.excalidraw]]` to a note. A preview shows in Reading view and
Live Preview. Use `![[drawing.excalidraw|400]]` to set a width.
Click the preview to edit. It updates after a save.

Use **Create new drawing and embed** from a note's right-click menu or the
command palette. Right-click a folder for **Create new drawing**.

Open a missing `[[drawing.excalidraw]]` or `![[drawing.excalidraw]]` to
create a blank drawing. Existing files are not replaced.

Only `.excalidraw` files are supported, not `.excalidraw.md` or frame crops.

### One drawing, one editor

Each `.excalidraw` file is editable in one Obsidian tab at a time. Opening a
drawing that is already open activates its existing tab. This prevents two
editors from saving competing versions of the same file.

Obsidian's pane menu also shows **Split right** and **Split down** for every
tab. Those commands belong to Obsidian, not to this plugin, so they cannot be
hidden only for drawings through the supported plugin API. If you use either
command on a drawing, Obsidian may briefly create a new pane; the plugin then
returns focus to the original drawing and closes the duplicate pane.

## Development

Requires Node.js 22.13 or later and npm.

> **Development note**
> Just Simple Excalidraw was unapologetically vibe-coded: built iteratively
> with AI assistance, then tested and refined inside a real Obsidian vault.

```bash
npm ci
npm run check
```

`npm run check` runs tests and build checks. Files go to `dist/`.
Set `JSE_DEV_VAULT` to a test vault's path to install the build there.

For an editable development build:

```bash
npm run dev
```

## Release

Tag the version in `manifest.json` (for example, `0.1.12`) to create a
GitHub release. This test build is marked as a pre-release.

## License and acknowledgements

This project is licensed under the [MIT License](LICENSE). It bundles
Excalidraw, React, and their production dependencies under their respective
licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Excalidraw is an independent open-source project. This plugin is not affiliated
with or endorsed by Excalidraw.

### Optional custom font

Place a WOFF2, WOFF, TTF or OTF file (up to 2 MB) inside the vault. In **Settings → Just Simple Excalidraw → Custom handwriting font**, enter its vault-relative path, such as `Fonts/My font.woff2`, then restart Obsidian. It replaces the Excalifont handwriting face in existing and new text using that face. Clear the setting and restart to restore the bundled font. Missing, invalid or oversized fonts fall back to Excalifont with a notice.

The font is loaded locally; no system paths or remote URLs are accepted. It is not embedded in each drawing: other devices need the font file and the same setting. Drawings remain standard Excalidraw JSON. Changing fonts can change text metrics, so keep settings consistent across devices. The release still bundles a single Latin fallback and remains below 5 MB.
