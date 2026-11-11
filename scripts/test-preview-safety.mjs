import assert from "node:assert/strict";
import { build } from "esbuild";

async function load(path) {
  const output = await build({ entryPoints: [path], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript,${encodeURIComponent(output.outputFiles[0].text)}`);
}
const { checkScene, checkFileSize, imageSize, PREVIEW_LIMITS: limit } = await load("src/preview-limits.ts");
const { createPreviewRenderer } = await load("src/drawing-preview.ts");
const scene = () => ({ elements: [{ id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 50 }], appState: {}, files: {} });
const png = (width, height) => {
  const buffer = Buffer.alloc(24);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "latin1"); buffer.write("IHDR", 12);
  buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buffer.toString("base64")}`;
};
const image = (url) => ({ id: "image", mimeType: "image/png", dataURL: url });
checkFileSize(limit.fileBytes);
assert.throws(() => checkFileSize(limit.fileBytes + 1), /12 MiB/);
assert.throws(() => checkFileSize(Infinity));
checkScene(scene());
for (const invalid of [null, {}, { elements: [], appState: [] }, { elements: [null], appState: {} }]) {
  assert.throws(() => checkScene(invalid));
}
const many = scene(); many.elements = Array(limit.elements + 1).fill(many.elements[0]);
assert.throws(() => checkScene(many), /5000/);
const points = scene(); points.elements[0].points = Array(limit.points + 1).fill([0, 0]);
assert.throws(() => checkScene(points), /50000/);
const text = scene(); text.elements[0].text = "x".repeat(limit.textCharacters + 1);
assert.throws(() => checkScene(text), /text/);
for (const value of [NaN, Infinity, -Infinity, 1e20, "200"]) {
  const bad = scene(); bad.elements[0].width = value;
  assert.throws(() => checkScene(bad));
}
for (const [key, value] of [["strokeWidth", 0.0001], ["fontSize", 1e5], ["roughness", 100]]) {
  const bad = scene(); bad.elements[0][key] = value; assert.throws(() => checkScene(bad));
}
const fill = scene(); Object.assign(fill.elements[0], { width: 8000, height: 8000, backgroundColor: "red", fillStyle: "hachure" });
assert.throws(() => checkScene(fill), /patterned fill/);
assert.equal(imageSize(png(640, 480)).width, 640);
for (const url of ["https://example.com/x.png", "data:image/svg+xml;base64,PHN2Zy8+", png(100000, 100000), "data:image/png;base64,!!"]) {
  assert.throws(() => imageSize(url));
}
const photos = scene(); photos.files = Object.fromEntries(Array.from({ length: 33 }, (_, n) => [n, image(png(1, 1))]));
assert.throws(() => checkScene(photos), /32 images/);
const pixelBomb = scene(); pixelBomb.files = { a: image(png(4096, 4096)), b: image(png(4096, 4096)), c: image(png(1, 1)) };
assert.throws(() => checkScene(pixelBomb), /too much image data/);

// The byte limit is checked before the file is read or the renderer is called.
let reads = 0, exports = 0;
let contents = JSON.stringify(scene());
let width = "8000", height = "4000", exportedText = "<svg/>";
const attrs = {};
const app = { vault: { async read() { reads++; return contents; } } };
const themes = [];
const library = {
  restoreElements(elements) { return elements; },
  getNonDeletedElements(elements) { return elements.filter(element => !element.isDeleted); },
  async exportToSvg(options) {
    exports++; themes.push(options.appState.exportWithDarkMode);
    return { getAttribute: key => key === "width" ? width : height, setAttribute: (key, value) => { attrs[key] = value; } };
  }
};
globalThis.XMLSerializer = class { serializeToString() { return exportedText; } };
const render = createPreviewRenderer(app, library);
await assert.rejects(render({ stat: { size: limit.fileBytes + 1 } }, false), /12 MiB/);
assert.equal(reads + exports, 0);
const file = { stat: { size: contents.length } };
await render(file, false); await render(file, true);
assert.deepEqual(themes, [false, true]);
assert.deepEqual(attrs, { width: "4096", height: "2048" });
contents = "not json";
await assert.rejects(render(file, false));
assert.equal(exports, 2);
contents = JSON.stringify(many);
await assert.rejects(render(file, false), /5000/);
assert.equal(exports, 2);
contents = JSON.stringify({ elements: [], appState: {}, files: {} });
assert.equal(await render(file, false), null);
contents = JSON.stringify(scene());
const stopped = new AbortController(); stopped.abort();
const before = reads;
await assert.rejects(render(file, false, stopped.signal));
assert.equal(reads, before);
exportedText = "x".repeat(limit.svgCharacters + 1);
await assert.rejects(render(file, false), /Preview too large/);
exportedText = "<svg/>"; width = "Infinity";
await assert.rejects(render(file, false), /Invalid preview size/);
console.log("Preview limits, image headers, themes, cancellation, and SVG size passed.");
