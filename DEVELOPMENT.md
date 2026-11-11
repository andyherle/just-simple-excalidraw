# Preview code

`drawing-preview-visibility.ts`: use Obsidian's editor state. Hide the active
link's preview and all Source mode previews. CodeMirror comes from Obsidian;
it is not bundled.

`preview-limits.ts`: check file size, scene size, and image headers before
export. Do not decode full images to check their size.

`drawing-preview.ts`: read, check, export. Do not save the drawing.
Cap SVG size and its initial image dimensions.

`drawing-preview-cache.ts`: share exports. Run at most two. Keep at most
20 completed entries and 4 MiB of SVG text. A file change clears its entries.

`drawing-embeds.ts`: show the SVG as an image. Never insert SVG as HTML.
On hide or close, cancel the request and revoke the image URL.
On plugin unload, clear the cache and all listeners.

Cancellation stops queued work and rejects old results. It cannot interrupt
Excalidraw's synchronous export work. Input limits reduce that work.

Run `npm run check`. Then test both note modes, both themes, link editing,
missing links, file rename/delete, repeated open/close, and plugin reload.
