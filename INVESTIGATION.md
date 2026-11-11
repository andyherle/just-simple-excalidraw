# Native Excalidraw note embeds

Date: 11 November 2026

Status: working source prototype; automated checks pass; live Obsidian validation remains open.

## Finding

The requested workflow is feasible in a small fork of Just Simple Excalidraw.
The existing Excalidraw renderer can produce the preview. The drawing remains
one standard `.excalidraw` JSON file. No generated SVG or PNG file is required
in the vault.

Investigation base: upstream `main`, commit
`7dc7356cb698d8f0ff0d41f2639d5fa1e046dc23`, version 0.1.11.

The upstream README explicitly excludes Markdown embeds. No current or closed
pull request in the inspected history implements this workflow. The only open
pull request at inspection was #39, a development type dependency update.
A personal fork is the appropriate place to test the change.

## User workflow

Write this in a note:

```md
![[drawing.excalidraw]]
```

The intended result is a static preview in Reading view and Live Preview.
Click the preview to open the drawing editor. The image updates after the
drawing saves. Multiple previews do not create multiple editing sessions.

A width can be supplied:

```md
![[drawing.excalidraw|400]]
```

To make a drawing from a note, right-click in the note editor and select
**Create new drawing and embed**. The matching command is available in the
command palette. The action creates a drawing, inserts its wikilink embed,
then opens the drawing. It uses Obsidian's new-file folder rule for the source
note. A folder's context menu also has **Create new drawing**.

Opening `[[missing.excalidraw]]` creates valid blank drawing JSON at the
resolved location. The native unresolved embed `![[missing.excalidraw]]`
uses the same creation path. Neither action appends `.md`.

Bare names use the configured new-file folder. Explicit `./` and `../` paths
are relative to the source note. Paths with a folder and no relative prefix
are vault-relative. A path cannot leave the vault. Existing files are opened
without being overwritten. Concurrent creation requests for the same path
share one write.

If the note changes while creation is pending, the embed is appended to its
end. If the editor switches to another note, insertion is cancelled and a
notice names the drawing that was created.

## Implementation

- `src/drawing-embeds.ts` registers a read-only native file embed component.
  Both host display modes use it. It exports the scene as an SVG and displays
  it through an image Blob URL. SVG markup is not inserted into the note DOM.
- `src/drawing-links.ts` adds the editor and folder menus and wraps
  `workspace.openLinkText` only for unresolved drawing links. Other links and
  their pane options are passed to the original handler.
- `main.ts` supplies valid drawing creation, editor opening, and SVG export.
  Previews do not claim the file owner or call the save path.
- Preview listeners handle save, rename, delete, recreation and theme changes.
  Older async exports cannot replace newer results. URLs and listeners are
  removed when a preview unloads.
- The build still uses local font data and has no new dependency. Drawing
  previews reject external image URLs rather than retrieve them.
- Development-vault installation is now opt-in with `JSE_DEV_VAULT`. The
  upstream hard-coded development-vault path is removed.

## Compatibility limits

Two native integration points are undocumented Obsidian internals:

1. `app.embedRegistry` registers the `.excalidraw` preview.
2. `fileManager.canCreateFileWithExt` allows the host to attach its normal
   click handler to a missing drawing embed. A narrow wrapper returns true
   only for this extension; the link wrapper writes the valid JSON.

Each adapter checks the host API and preserves other handlers on unload.
The registration does not replace another plugin's existing preview renderer.

The official Obsidian 1.15.0 application was inspected locally. Its native
registry matches this adapter. Its Reading and Live Preview components load
the child before calling `loadFile()`. Its missing-embed click routes to
`workspace.openLinkText`, after the creatable-extension check. This is static
compatibility evidence, not a live test pass.

This branch supports raw `.excalidraw` JSON only. It does not add parsing for
`.excalidraw.md`, an inline drawing editor, frame/element crops, OCR, sync,
or a drawing library. A fragment such as `#section` shows the whole drawing.
Preview refresh follows saved file changes rather than each unsaved stroke.
Many repeated embeds currently render independently; there is no shared cache.

## Validation

`npm run check` passed. It includes TypeScript, the upstream file isolation,
theme, environment and font tests, the new interaction and preview tests,
the production build, and the existing release audit. The build remains
below the existing 5,000,000-byte release limit.

The new tests exercise source-aware paths, native open options, concurrent
creation, note changes during creation, non-drawing link delegation, preview
updates, deletion and recreation, stale async results, and unload cleanup.

A live Obsidian 1.15.0 test was attempted in a new test vault. The environment
blocked socket creation during app startup. Its approval policy rejected
running the app outside that process sandbox. No live desktop result is
claimed. No user vault was modified.

Remaining host checks:

1. Open a note containing an existing drawing embed in Reading view and Live Preview.
2. Click the preview, edit the drawing, save, and return to the note.
3. Use **Create new drawing and embed** in the note editor.
4. Click both a missing plain drawing link and a missing drawing embed.
5. Disable and re-enable the plugin; check that normal note links still work.

## Test installation

Use a separate test vault for this prototype. The plugin ID remains
`just-simple-excalidraw`; it replaces that plugin in the test vault.

In the separately supplied ZIP, copy `main.js`, `manifest.json`, and
`styles.css` from `plugin/` into the vault's
`.obsidian/plugins/just-simple-excalidraw/` folder.
Restart Obsidian and enable Just Simple Excalidraw in Community plugins.
The package also contains a Git patch with all source changes, based on the
upstream commit above.

For a source build:

```sh
npm ci
npm run check
```

For this source build, copy those three generated files from `dist/`.

## Fork status

The investigation branch is `investigate/native-drawing-embeds` in
[andyherle/just-simple-excalidraw](https://github.com/andyherle/just-simple-excalidraw).
It is a prototype for review and live testing, not a published stable release.
No upstream PR, issue or comment was created.

## Sources

- [Upstream README and scope](https://github.com/DavidHurtadoAI/just-simple-excalidraw/blob/7dc7356cb698d8f0ff0d41f2639d5fa1e046dc23/README.md)
- [Upstream implementation](https://github.com/DavidHurtadoAI/just-simple-excalidraw/blob/7dc7356cb698d8f0ff0d41f2639d5fa1e046dc23/main.ts)
- [Upstream pull requests](https://github.com/DavidHurtadoAI/just-simple-excalidraw/pulls)
- [Excalidraw export API](https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export)
- [Official Obsidian API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
- [Obsidian 1.15.0 release used for compatibility inspection](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.15.0)
- [Existing native registry integration example](https://github.com/mnaoumov/obsidian-embed-html/blob/main/src/embed/html-embed-registry-component.ts)
