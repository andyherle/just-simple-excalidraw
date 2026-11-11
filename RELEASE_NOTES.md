# 0.1.12 — native drawing preview test

This is a test build for `andyherle/just-simple-excalidraw`, based on upstream
0.1.11. The plugin ID stays `just-simple-excalidraw`.

## Changes

- Show a preview for `![[drawing.excalidraw]]` in Reading view and Live Preview.
- Click a preview to open the drawing editor.
- Use **Create new drawing and embed** from the note editor's right-click menu
  or command palette.
- Use **Create new drawing** from a folder's right-click menu.
- Click an unresolved `.excalidraw` link or embed to create a valid drawing.
- Keep standard `.excalidraw` JSON files. The note stores only a link. No
  separate image export is saved in the vault.

## QA fixes

- Repeated previews share an export for the same file version and theme.
- At most two SVG exports run at once. The completed preview cache holds at
  most 20 entries and 4 MiB of SVG text. Larger results are not retained.
- A new save replaces pending work for an old file version. Unloaded previews
  cancel their requests. An active Excalidraw export finishes before its
  result is discarded; that library call cannot be interrupted mid-export.
- A CSS event with no theme change does not export the drawing again.
- Deleted drawings stay missing during theme changes. Recreated drawings
  can display again.
- Missing-link creation keeps the target pane chosen before the file write.
  Background open requests do not take focus from the active note.
- Concurrent clicks share one file creation. Existing files are not overwritten.
- The build checks matching release versions and keeps `main.js` below
  5,000,000 bytes. No dependency was added for these features.

## Install

Use Obsidian **1.13.7 or later**. The new host integration was inspected in
1.15.0, but a live app test is still required.

For manual installation, copy `main.js`, `manifest.json`, and `styles.css`
from this release into:

```text
<vault>/.obsidian/plugins/just-simple-excalidraw/
```

If you use the ZIP, copy its `just-simple-excalidraw` folder into
`<vault>/.obsidian/plugins/`. The license files can remain in that folder.
Restart Obsidian. Enable **Just Simple Excalidraw** in Community plugins.
Check that its displayed version is **0.1.12**.

The ID matches the existing plugin. These files replace that plugin in the
chosen vault. The minimum version is inherited from upstream.

## Test in a note

1. Add `![[drawing.excalidraw]]` for an existing drawing. Check both Reading
   view and Live Preview.
2. Click the preview. Edit the drawing, wait for autosave, and return to the
   note. Check that the preview changes.
3. Right-click in the note. Select **Create new drawing and embed**.
4. Try `[[new-diagram.excalidraw]]` and `![[new-embed.excalidraw]]`. Click each
   link. Check that each creates a drawing, with no `.md` suffix.
5. Repeat one embed several times. Change the theme, rename the drawing,
   and disable and enable the plugin. Check that the note remains usable.

## Test scope

`npm run check` passed for this build. The compiled `main.js` is **4,934,110
bytes**, below the 5,000,000-byte limit.

Automated checks cover file isolation, host link options, creation races,
source-note changes, preview lifecycle, stale results, shared exports,
cache limits, theme events, TypeScript, fonts, and the production bundle.

`npm audit --omit=dev --audit-level=high` passed its severity gate. It reports
four low-severity findings in the KaTeX/Mermaid dependency chain. The release
audit confirms that those packages are excluded from the compiled bundle.

The preview tests use a test renderer. They do not prove the visual output
of Excalidraw's real SVG exporter. Desktop, mobile, popout windows, text and
embedded images still need a live Obsidian test. The available environment
blocked socket creation during Obsidian startup, so no live app pass is claimed.

The preview registry and missing-embed creation gate are private Obsidian
APIs. The adapters check them before use. Raw `.excalidraw` JSON is supported;
`.excalidraw.md` and element or frame crops are outside this test build.
