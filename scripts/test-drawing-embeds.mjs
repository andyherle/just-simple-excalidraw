import assert from "node:assert/strict";
import { build } from "esbuild";

// Only the native editor boundary is mocked. No browser or new test package.
async function load(path) {
  const result = await build({
    entryPoints: [path], bundle: true, format: "esm", platform: "node", write: false,
    plugins: [{ name: "editor-host", setup(builder) {
      builder.onResolve({ filter: /^(obsidian|@codemirror\/view)$/ }, args => ({ path: args.path, namespace: "host" }));
      builder.onLoad({ filter: /.*/, namespace: "host" }, args => ({ loader: "js", contents: args.path === "obsidian"
        ? 'export const editorLivePreviewField = "live";'
        : 'export const EditorView = { findFromDOM: el => el.view }; export const ViewPlugin = { fromClass: type => type };' }));
    } }]
  });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
}
const { checkScene, checkFileSize, imageSize, createPreviewRenderer, PREVIEW_LIMITS: limits } = await load("src/drawing-preview.ts");
const { DrawingPreviewCache } = await load("src/drawing-preview-cache.ts");
const { embedRange, registerPreviewVisibility } = await load("src/drawing-preview-visibility.ts");
const settle = () => new Promise(resolve => setImmediate(resolve));
const scene = { elements: [{ id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }], appState: {}, files: {} };

// Reject excessive input before Excalidraw restores or exports it.
checkScene(scene);
checkFileSize(limits.fileBytes);
assert.throws(() => checkFileSize(limits.fileBytes + 1));
for (const invalid of [null, {}, { ...scene, elements: [null] },
  { ...scene, elements: Array(limits.elements + 1).fill(scene.elements[0]) },
  { ...scene, elements: [{ ...scene.elements[0], width: Infinity }] },
  { ...scene, elements: [{ ...scene.elements[0], points: Array(limits.points + 1).fill([0, 0]) }] }]) {
  assert.throws(() => checkScene(invalid));
}
function png(width, height) {
  const header = Buffer.alloc(24);
  header.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  header.write("IHDR", 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
}
assert.equal(imageSize(png(640, 480)).width, 640);
for (const url of ["https://example.com/x.png", "data:image/svg+xml;base64,PHN2Zy8+", png(100000, 100000)]) {
  assert.throws(() => imageSize(url));
}
let reads = 0;
const themes = [];
const attributes = {};
const render = createPreviewRenderer({ vault: { async read() { reads++; return JSON.stringify(scene); } } }, {
  restoreElements: elements => elements,
  getNonDeletedElements: elements => elements,
  async exportToSvg(options) {
    themes.push(options.appState.exportWithDarkMode);
    return { getAttribute: key => key === "width" ? "8000" : "4000", setAttribute: (key, value) => { attributes[key] = value; } };
  }
});
globalThis.XMLSerializer = class { serializeToString() { return "<svg/>"; } };
await assert.rejects(render({ stat: { size: limits.fileBytes + 1 } }, false));
assert.equal(reads, 0);
await render({ stat: { size: 500 } }, false);
await render({ stat: { size: 500 } }, true);
assert.deepEqual(themes, [false, true]);
assert.deepEqual(attributes, { width: "4096", height: "2048" });
delete globalThis.XMLSerializer;

// Share work, limit parallel exports, and cancel the last unused request.
const jobs = [];
const cache = new DrawingPreviewCache((file, dark, signal) => new Promise(resolve => jobs.push({ file, signal, resolve })));
const file = { path: "a.excalidraw", stat: { mtime: 1, size: 100 } };
const first = new AbortController(), second = new AbortController();
const a = cache.get(file, false, first.signal);
const b = cache.get(file, false, second.signal);
await settle();
assert.equal(jobs.length, 1);
first.abort();
assert.equal(jobs[0].signal.aborted, false);
jobs[0].resolve("<svg/>");
assert.equal(await a, null);
assert.equal(await b, "<svg/>");
assert.equal(await cache.get(file, false, new AbortController().signal), "<svg/>");
assert.equal(jobs.length, 1);
cache.invalidate(file);
const c = cache.get(file, false, second.signal);
await settle();
assert.equal(jobs.length, 2);
second.abort();
assert.equal(await c, null);
assert.equal(jobs[1].signal.aborted, true);
jobs[1].resolve(null);
await settle();
const pending = Array.from({ length: 3 }, (_, index) => cache.get({ ...file, path: `test-${index}` }, false, new AbortController().signal));
await settle();
assert.equal(jobs.length, 4, "Only two new exports can start.");
cache.dispose();
assert.deepEqual(await Promise.all(pending), [null, null, null]);
for (const job of jobs) job.resolve(null);
await settle();

// Respect Source mode and the link being edited; ignore unrelated selections.
const text = "before ![[drawing.excalidraw]] after";
const range = embedRange(text, 0, 10);
assert.deepEqual(range, { from: 7, to: 30 });
assert.equal(embedRange("plain text", 0, 0), null);
assert.equal(embedRange("\\![[escaped.excalidraw]]", 0, 1), null);
let Extension;
const cleanups = [];
const watch = registerPreviewVisibility({ registerEditorExtension(value) { Extension = value; }, register(fn) { cleanups.push(fn); } });
const state = {
  live: true,
  field() { return this.live; },
  doc: { length: text.length, lineAt: () => ({ text, from: 0, to: text.length }) },
  selection: { ranges: [{ from: 0, to: 0, empty: true }] }
};
const view = { state, dom: { contains: element => element.view === view }, requestMeasure() {}, posAtDOM: () => 7 };
const listener = new Extension(view);
const visible = [];
const subscription = watch({ view, closest: () => ({}) }, value => visible.push(value));
await settle();
assert.equal(visible.at(-1), true);
state.selection.ranges = [{ from: 10, to: 10, empty: true }];
listener.update({ state, selectionSet: true });
await settle();
assert.equal(visible.at(-1), false);
state.selection.ranges = [{ from: 0, to: 0, empty: true }];
listener.update({ state, selectionSet: true });
await settle();
assert.equal(visible.at(-1), true);
state.live = false;
listener.update({ state });
await settle();
assert.equal(visible.at(-1), false);
subscription.dispose();
const count = visible.length;
state.live = true;
listener.update({ state });
await settle();
assert.equal(visible.length, count);
for (const cleanup of cleanups) cleanup();
listener.destroy();
console.log("Drawing preview limits, shared work, themes, editor modes, and cleanup passed.");
