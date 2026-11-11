# 0.1.12 (test build)

Excalidraw drawings can now show in Obsidian notes.

## Changes

- `![[drawing.excalidraw]]` shows a preview in Reading view and Live Preview.
- Click a preview to edit. It updates after a save.
- **Create new drawing and embed** adds a drawing from a note.
- Missing `.excalidraw` links create blank drawings.
- Repeated previews share work. No extra image files are saved.

## Install

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/just-simple-excalidraw/
```

Restart Obsidian and enable the plugin. This replaces the installed copy in
that vault. Use Obsidian 1.13.7 or later.

## Test

1. Embed a drawing. Check Reading view and Live Preview.
2. Click it, edit, save, and return to the note.
3. Use **Create new drawing and embed** in a note.
4. Open `[[new.excalidraw]]` and `![[new-embed.excalidraw]]`.
5. Check a rename, theme change, and plugin reload.

`npm run check` passed. A live Obsidian test is still needed.

Previews use internal Obsidian APIs. Only `.excalidraw` JSON is supported,
not `.excalidraw.md` or frame crops.
