import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({
  entryPoints: ["src/drawing-preview-visibility.ts"], bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "editor-host", setup(builder) {
    builder.onResolve({ filter: /^(obsidian|@codemirror\/view)$/ }, args => ({ path: args.path, namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, args => ({ contents: args.path === "obsidian"
      ? 'export const editorLivePreviewField = "live";'
      : 'export const EditorView = { findFromDOM: el => el.view }; export const ViewPlugin = { fromClass: type => type };', loader: "js" }));
  } }]
});
const { embedRange, registerPreviewVisibility } = await import(`data:text/javascript,${encodeURIComponent(output.outputFiles[0].text)}`);
const source = "before ![[drawing.excalidraw|400]] after ![[other.excalidraw]]";
const first = embedRange(source, 0, 9), second = embedRange(source, 0, 45);
assert.equal(first.from, 7); assert.equal(second.from, source.indexOf("![[other"));
assert.equal(embedRange("plain text", 0, 0), null);
assert.equal(embedRange("\\![[escaped.excalidraw]]", 0, 1), null);
assert.deepEqual(embedRange("![x](<a file.excalidraw>)", 0, 0), { from: 0, to: 25 });
let extension;
const cleanups = [];
const plugin = { registerEditorExtension(value) { extension = value; }, register(fn) { cleanups.push(fn); } };
const watch = registerPreviewVisibility(plugin);
const makeView = () => {
  const state = {
    live: true,
    field() { return this.live; },
    doc: { length: source.length, lineAt() { return { text: source, from: 0, to: source.length }; } },
    selection: { ranges: [{ from: 0, to: 0, empty: true }] }
  };
  const view = { state, dom: { contains: element => element.view === view }, requestMeasure() {}, posAtDOM: element => element.position };
  const listener = new extension(view);
  return { view, state, listener };
};
const a = makeView(), b = makeView();
const element = { view: a.view, position: 7, closest: () => ({}) };
const seen = [], other = [];
const off = watch(element, visible => seen.push(visible));
const offOther = watch({ view: b.view, position: 7, closest: () => ({}) }, visible => other.push(visible));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
await settle(); assert.equal(seen.at(-1), true);
const update = () => a.listener.update({ state: a.state, selectionSet: true });
a.state.selection.ranges = [{ from: 10, to: 10, empty: true }]; update(); await settle();
assert.equal(seen.at(-1), false);
assert.equal(other.at(-1), true, "Another editor must stay visible.");
a.state.selection.ranges = [{ from: 2, to: 2, empty: true }]; update(); await settle();
assert.equal(seen.at(-1), true);
a.state.live = false; a.listener.update({ state: a.state }); await settle();
assert.equal(seen.at(-1), false, "Source mode must not show previews.");
a.state.live = true; a.listener.update({ state: a.state }); await settle();
assert.equal(seen.at(-1), true);
a.state.selection.ranges = [{ from: 0, to: 0, empty: true }, { from: 10, to: 20, empty: false }]; update(); await settle();
assert.equal(seen.at(-1), false, "All selections must be checked.");
const reading = [];
const offReading = watch({ closest: () => null }, value => reading.push(value));
await settle(); assert.equal(reading.at(-1), true);
off.dispose(); const count = seen.length; update(); await settle(); assert.equal(seen.length, count);
offOther.dispose(); offReading.dispose();
for (const fn of cleanups) fn();
a.listener.destroy(); b.listener.destroy();
console.log("Source mode, link editing, multiple selections, separate editors, and cleanup passed.");
