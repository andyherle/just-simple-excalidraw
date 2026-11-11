// One-use build task. Removed after the checked commit is saved.
import { readFile, writeFile } from "node:fs/promises";
const read = path => readFile(path, "utf8");
async function edit(path, transform) {
  const before = await read(path), after = transform(before);
  if (after === before) throw new Error(`No change: ${path}`);
  await writeFile(path, after);
}
const replace = (text, before, after) => {
  if (!text.includes(before)) throw new Error(`Missing source: ${before.slice(0, 70)}`);
  return text.replace(before, after);
};
await edit("main.ts", source => {
  source = replace(source, 'import { registerDrawingLinks } from "./src/drawing-links";',
    'import { registerDrawingLinks } from "./src/drawing-links";\nimport { createPreviewRenderer } from "./src/drawing-preview";\nimport { registerPreviewVisibility } from "./src/drawing-preview-visibility";');
  const start = source.indexOf("    registerDrawingEmbeds(this, async (file, dark, signal) => {");
  const end = source.indexOf("\n  }\n\n  async createDrawing", start);
  if (start < 0 || end < 0) throw new Error("Preview renderer block changed.");
  return source.slice(0, start) + "    registerDrawingEmbeds(this, createPreviewRenderer(this.app, drawingLibrary), registerPreviewVisibility(this));" + source.slice(end);
});
await edit("esbuild.config.mjs", source => replace(source,
  'external: ["obsidian", "electron", ...builtinModules]',
  'external: ["obsidian", "@codemirror/view", "electron", ...builtinModules]'));
await edit("scripts/audit-release.mjs", source => replace(source,
  'dependency !== "obsidian"', 'dependency !== "obsidian" && dependency !== "@codemirror/view"'));
for (const name of ["test-file-isolation", "test-font-loading", "test-theme"]) {
  await edit(`scripts/${name}.mjs`, source => replace(source, "const mocks = {",
    'const mocks = {\n  "./src/drawing-preview-visibility": "export const registerPreviewVisibility = () => undefined;",'));
}
await edit("scripts/test-drawing-embeds.mjs", source => {
  source = replace(source,
    'assert.equal(drawing.button.getAttribute("aria-label"), "Open diagram.excalidraw");',
    'assert.equal(drawing.button.getAttribute("aria-label"), null);\nassert.equal(drawing.button.title ?? "", "");\nassert.equal(drawing.container.childNodes[1].textContent, "Open diagram.excalidraw");\nassert.equal(drawing.button.getAttribute("aria-labelledby"), drawing.container.childNodes[1].id);');
  source = source.replace('/Cannot preview this drawing.*Invalid JSON/', '/Cannot preview this drawing/');
  source = replace(source, "    start() {\n      registerDrawingEmbeds", "    start(watch) {\n      registerDrawingEmbeds");
  source = replace(source, "        return renderer(file, dark, signal);\n      });", "        return renderer(file, dark, signal);\n      }, watch);");
  return source + `
// Hiding a preview cancels work and frees its image. No timer runs in Source mode.
const hidden = runtime();
let toggle, visibilityCleanups = 0;
hidden.start((_element, change) => { toggle = change; return { refresh() {}, dispose() { visibilityCleanups++; } }; });
const item = hidden.mount();
item.preview.loadFile(); await settle();
assert.equal(hidden.renders.length, 0);
assert.equal(item.container.hidden, true);
toggle(true); await settle();
assert.equal(hidden.renders.length, 1);
assert.equal(item.container.hidden, false);
for (let i = 0; i < 100; i++) {
  toggle(false); await settle();
  assert.equal(item.button.firstElementChild, null);
  toggle(true); await settle();
}
assert.equal(hidden.renders.length, 1, "Showing the same file must reuse its SVG.");
assert.equal(hidden.blobs.size - hidden.revoked.length, 1, "Only the current image URL stays live.");
hidden.doc.body.classList.add("theme-dark"); hidden.app.workspace.emit("css-change"); await settle();
assert.equal(hidden.renders.at(-1).dark, true);
hidden.doc.body.classList.remove("theme-dark"); hidden.app.workspace.emit("css-change"); await settle();
assert.equal(hidden.renders.length, 2, "Returning to light mode must reuse its SVG.");
item.button.firstElementChild.onerror();
assert.match(item.button.textContent, /Cannot show preview/);
assert.equal(hidden.blobs.size, hidden.revoked.length);
hidden.unload();
assert.equal(visibilityCleanups, 1);
assert.equal(hidden.app.vault.count() + hidden.app.workspace.count(), 0);
assert.equal(hidden.observers.size, 0);
console.log("Hover labels, hidden previews, repeated toggles, decode errors, and cleanup passed.");
`;
});
for (const path of ["manifest.json", "package.json", "package-lock.json"]) {
  const json = JSON.parse(await read(path));
  if (json.version !== "0.1.12") throw new Error(`Unexpected version: ${path}`);
  json.version = "0.1.13";
  if (path === "package-lock.json") json.packages[""].version = "0.1.13";
  if (path === "package.json") json.scripts.test += " && node scripts/test-preview-safety.mjs && node scripts/test-preview-visibility.mjs";
  await writeFile(path, JSON.stringify(json, null, 2) + "\n");
}
const versions = JSON.parse(await read("versions.json"));
versions["0.1.13"] = "1.13.7";
await writeFile("versions.json", JSON.stringify(versions, null, 2) + "\n");
await edit("src/styles.css", source => source + `
/* Keep source text visible. Do not change other embeds. */
.just-simple-excalidraw-embed[hidden],
.markdown-source-view:not(.is-live-preview) .just-simple-excalidraw-embed {
  display: none;
}
.just-simple-excalidraw-preview:focus-visible {
  outline: 2px solid var(--interactive-accent);
  outline-offset: 2px;
}
`);
await edit("CHANGELOG.md", source => `## 0.1.13

- Remove preview tooltips.
- Hide previews in Source mode and while editing their links.
- Limit large previews. Release hidden images.
- Shorten the guide.

${source}`);
console.log("Preview update applied. Run all checks before commit.");
