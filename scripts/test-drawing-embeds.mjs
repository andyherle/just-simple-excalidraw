import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notices = [];

// A small host fixture, not an SVG renderer. Native widget creation still
// requires a live Obsidian check; this suite exercises the async lifetime.
class Component {
  cleanups = [];
  loaded = false;
  register(cleanup) { this.cleanups.push(cleanup); }
  registerEvent(ref) { this.register(() => ref.owner.offref(ref)); }
  registerDomEvent(element, type, callback) {
    element.addEventListener(type, callback);
    this.register(() => element.removeEventListener(type, callback));
  }
  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.onload?.();
  }
  unload() {
    if (!this.loaded) return;
    this.loaded = false;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.onunload?.();
  }
}
class TFile {
  stat = { mtime: 1, size: 100 };
  constructor(path) { this.setPath(path); }
  setPath(path) {
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.excalidraw$/, "");
  }
}
class Notice { constructor(message) { notices.push(message); } }
globalThis.__drawingEmbedRuntime = { Component, TFile, Notice };

const bundle = await build({
  absWorkingDir: projectDirectory,
  entryPoints: ["src/drawing-embeds.ts"],
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "mock-embed-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
      contents: "export const { Component, TFile, Notice } = globalThis.__drawingEmbedRuntime;",
      loader: "js"
    }));
  } }]
});
const { registerDrawingEmbeds } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
delete globalThis.__drawingEmbedRuntime;

function events() {
  const refs = new Set();
  return {
    on(name, callback) { const ref = { owner: this, name, callback }; refs.add(ref); return ref; },
    offref(ref) { refs.delete(ref); },
    emit(name, ...args) { for (const ref of [...refs]) if (ref.name === name) ref.callback(...args); },
    count: () => refs.size
  };
}

function documentFixture() {
  const observers = new Set();
  const blobs = new Map();
  const revoked = [];
  let serial = 0;
  class Element {
    attributes = new Map();
    listeners = new Map();
    childNodes = [];
    parentNode = null;
    style = {};
    classList = new Set();
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.classList.contains = this.classList.has.bind(this.classList);
      this.classList.remove = this.classList.delete.bind(this.classList);
    }
    replaceChildren(...children) {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = children;
      for (const child of children) child.parentNode = this;
    }
    set textContent(value) { this.replaceChildren(...(value ? [{ textContent: value }] : [])); }
    get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
    get firstElementChild() { return this.childNodes.find(child => child instanceof Element) ?? null; }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      this.notify(name);
    }
    removeAttribute(name) { this.attributes.delete(name); this.notify(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    notify(name) {
      for (const observer of observers) {
        if (observer.target === this && observer.options.attributeFilter.includes(name)) observer.callback();
      }
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    click() {
      const event = {
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; }
      };
      for (const callback of this.listeners.get("click") ?? []) callback(event);
      return event;
    }
    remove() {
      if (this.parentNode) this.parentNode.replaceChildren(...this.parentNode.childNodes.filter(child => child !== this));
    }
  }
  const doc = {
    createElement: tag => new Element(tag),
    defaultView: {
      Blob,
      URL: {
        createObjectURL(blob) { const url = `blob:preview/${++serial}`; blobs.set(url, blob); return url; },
        revokeObjectURL(url) { revoked.push(url); }
      },
      MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe(target, options) { this.target = target; this.options = options; observers.add(this); }
        disconnect() { observers.delete(this); }
      }
    }
  };
  doc.body = doc.createElement("body");
  return { doc, blobs, revoked, observers };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function runtime() {
  const page = documentFixture();
  const renders = [];
  const opened = [];
  const registration = [];
  const unregistration = [];
  const cleanups = [];
  const writes = [];
  const files = new Map();
  const vaultEvents = events();
  let renderer = async () => "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>Diagram</text></svg>";
  const registry = {
    embedByExtension: {},
    registerExtensions(extensions, creator) {
      registration.push([...extensions]);
      for (const extension of extensions) this.embedByExtension[extension] = creator;
    },
    unregisterExtensions(extensions) {
      unregistration.push([...extensions]);
      for (const extension of extensions) delete this.embedByExtension[extension];
    }
  };
  const app = {
    embedRegistry: registry,
    vault: {
      ...vaultEvents,
      emit(name, file, ...args) {
        if (name === "create") files.set(file.path, file);
        if (name === "delete" && files.get(file.path) === file) files.delete(file.path);
        if (name === "rename") { files.delete(args[0]); files.set(file.path, file); }
        vaultEvents.emit(name, file, ...args);
      },
      getAbstractFileByPath(path) { return files.get(path) ?? null; },
      async create(...args) { writes.push(["create", ...args]); },
      async modify(...args) { writes.push(["modify", ...args]); },
      async delete(...args) { writes.push(["delete", ...args]); }
    },
    workspace: { ...events(), async openLinkText(...args) { opened.push(args); } }
  };
  const plugin = {
    app,
    register(cleanup) { cleanups.push(cleanup); },
    registerEvent(ref) { cleanups.push(() => ref.owner.offref(ref)); }
  };
  return {
    ...page, app, registry, registration, unregistration, renders, opened, writes, files,
    start() {
      registerDrawingEmbeds(plugin, (file, dark, signal) => {
        renders.push({ file, dark, signal });
        return renderer(file, dark, signal);
      });
    },
    useRenderer(next) { renderer = next; },
    mount(file = new TFile("Drawings/diagram.excalidraw")) {
      files.set(file.path, file);
      const container = page.doc.createElement("div");
      const preview = registry.embedByExtension.excalidraw({ containerEl: container, sourcePath: "Notes/source.md" }, file);
      preview.load();
      return { preview, container, file, button: container.firstElementChild };
    },
    unload() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); }
  };
}

// Missing or incompatible internal APIs must leave ordinary drawing use alone.
for (const invalid of [undefined, {}, { embedByExtension: {} }, { embedByExtension: {}, registerExtensions() {} }]) {
  const host = runtime();
  host.app.embedRegistry = invalid;
  const before = notices.length;
  host.start();
  assert.equal(notices.length, before + 1);
  assert.equal(host.registration.length, 0);
  host.unload();
}
const occupied = runtime();
const otherCreator = () => {};
occupied.registry.embedByExtension.excalidraw = otherCreator;
occupied.start();
occupied.unload();
assert.equal(occupied.registry.embedByExtension.excalidraw, otherCreator);
assert.equal(occupied.unregistration.length, 0);

// Rendering uses an isolated image in its own window, never a scene editor or
// inline SVG. Opening the preview retains the source note's link context.
const basic = runtime();
basic.start();
assert.deepEqual(basic.registration, [["excalidraw"]]);
const drawing = basic.mount();
assert.equal(basic.renders.length, 0, "Creating/loading the component alone must not render twice.");
drawing.preview.loadFile();
await settle();
const firstImage = drawing.button.firstElementChild;
assert.equal(firstImage.tagName, "IMG");
assert.equal(firstImage.alt, "diagram");
assert.equal(firstImage.draggable, false);
assert.equal(basic.blobs.get(firstImage.src).type, "image/svg+xml");
assert.match(await basic.blobs.get(firstImage.src).text(), /Diagram/);
assert.equal(drawing.button.getAttribute("aria-busy"), null);
assert.equal(drawing.button.getAttribute("aria-label"), "Open diagram.excalidraw");
const clicked = drawing.button.click();
await settle();
assert.equal(clicked.prevented && clicked.stopped, true);
assert.deepEqual(basic.opened, [[drawing.file.path, "Notes/source.md", "tab"]]);
assert.deepEqual(basic.writes, [], "Preview lifecycle must not write drawing files.");
basic.app.vault.emit("modify", new TFile("Other.excalidraw"));
assert.equal(basic.renders.length, 1, "Unrelated files must not trigger another export.");
basic.app.workspace.emit("css-change");
drawing.preview.loadFile();
drawing.preview.setSubpath("#unused");
await settle();
assert.equal(basic.renders.length, 1, "Unchanged theme and repeated host requests must reuse the displayed version.");
assert.equal(basic.blobs.size, 1, "Repeated requests must not allocate another image URL.");

// Dimensions update without re-export; invalid values cannot become CSS.
drawing.container.setAttribute("width", "400");
drawing.container.setAttribute("height", "200");
assert.deepEqual(firstImage.style, { width: "400px", height: "200px" });
drawing.container.setAttribute("width", "20000");
drawing.container.setAttribute("height", "10px; background: red");
assert.deepEqual(firstImage.style, { width: "10000px", height: "" });
for (const invalid of ["0", "-1", "1.5", "", "auto"]) {
  drawing.container.setAttribute("width", invalid);
  assert.equal(firstImage.style.width, "");
}
assert.equal(basic.renders.length, 1);
basic.doc.body.classList.add("theme-dark");
basic.app.workspace.emit("css-change");
await settle();
assert.equal(basic.renders.at(-1).dark, true);
assert.deepEqual(basic.revoked, [firstImage.src]);
drawing.file.setPath("Drawings/renamed.excalidraw");
basic.app.vault.emit("rename", drawing.file, "Drawings/diagram.excalidraw");
await settle();
drawing.button.click();
assert.equal(basic.opened.at(-1)[0], "Drawings/renamed.excalidraw");
assert.equal(drawing.button.firstElementChild.alt, "renamed");

// Older exports and failures cannot replace a newer render.
const race = runtime();
const pending = [];
race.useRenderer(() => { const result = deferred(); pending.push(result); return result.promise; });
race.start();
const changing = race.mount();
changing.preview.loadFile();
await settle();
race.app.vault.emit("modify", changing.file);
await settle();
assert.equal(race.renders[0].signal.aborted, true, "A new file version must cancel the old export when possible.");
pending[1].resolve("<svg>new</svg>");
await settle();
const currentUrl = changing.button.firstElementChild.src;
pending[0].reject(new Error("stale read failed"));
await settle();
assert.equal(changing.button.firstElementChild.src, currentUrl);
assert.equal(race.blobs.size, 1);
race.app.vault.emit("modify", changing.file);
await settle();
race.app.vault.emit("modify", changing.file);
await settle();
pending[3].resolve("<svg>newest</svg>");
await settle();
pending[2].resolve("<svg>old</svg>");
await settle();
assert.equal(await race.blobs.get(changing.button.firstElementChild.src).text(), "<svg>newest</svg>");
assert.deepEqual(race.revoked, [currentUrl]);

// Deletion invalidates in-flight work. A newly created TFile at the same path
// replaces the old identity, and unrelated creations do not wake the preview.
race.app.vault.emit("modify", changing.file);
await settle();
const beforeDeleteUrl = changing.button.firstElementChild.src;
race.app.vault.emit("delete", changing.file);
assert.match(changing.button.textContent, /Drawing missing/);
assert.ok(race.revoked.includes(beforeDeleteUrl));
pending[4].resolve("<svg>deleted</svg>");
await settle();
assert.equal(changing.button.firstElementChild, null);
race.doc.body.classList.add("theme-dark");
race.app.workspace.emit("css-change");
changing.preview.loadFile();
await settle();
assert.match(changing.button.textContent, /Drawing missing/);
assert.equal(pending.length, 5, "Theme changes must not resurrect or read a deleted drawing.");
race.app.vault.emit("create", new TFile("Other/diagram.excalidraw"));
assert.equal(pending.length, 5);
const replacement = new TFile(changing.file.path);
race.app.vault.emit("create", replacement);
await settle();
assert.equal(race.renders.at(-1).file, replacement);
pending[5].resolve("<svg>recreated</svg>");
await settle();
assert.equal(await race.blobs.get(changing.button.firstElementChild.src).text(), "<svg>recreated</svg>");
const countBeforeOldModify = pending.length;
race.app.vault.emit("modify", changing.file);
assert.equal(pending.length, countBeforeOldModify);

// Empty scenes and read errors stay visible as messages and release images.
const currentBeforeEmpty = changing.button.firstElementChild.src;
race.app.vault.emit("modify", replacement);
await settle();
pending[6].resolve(null);
await settle();
assert.match(changing.button.textContent, /Empty drawing/);
assert.ok(race.revoked.includes(currentBeforeEmpty));
race.app.vault.emit("modify", replacement);
await settle();
pending[7].reject(new Error("Invalid JSON"));
await settle();
assert.match(changing.button.textContent, /Cannot preview this drawing.*Invalid JSON/);
assert.equal(changing.button.getAttribute("aria-busy"), null);
assert.deepEqual(race.writes, []);

// Plugin unload releases components even if another plugin replaced the
// registry entry. Late promises and later host events must do no work.
const survivor = basic.mount(new TFile("second.excalidraw"));
survivor.preview.loadFile();
await settle();
basic.registry.embedByExtension.excalidraw = otherCreator;
const oldButton = survivor.button;
basic.unload();
assert.equal(basic.registry.embedByExtension.excalidraw, otherCreator);
assert.equal(basic.unregistration.length, 0);
assert.equal(basic.app.vault.count() + basic.app.workspace.count(), 0);
assert.equal(basic.observers.size, 0);
assert.equal(drawing.container.childNodes.length + survivor.container.childNodes.length, 0);
assert.equal(new Set(basic.revoked).size, basic.blobs.size);
const openedBeforeUnloadClick = basic.opened.length;
oldButton.click();
assert.equal(basic.opened.length, openedBeforeUnloadClick);
changing.preview.loadFile();
await settle();
const blobsBeforeUnload = race.blobs.size;
race.unload();
pending[8].resolve("<svg>too late</svg>");
await settle();
race.app.vault.emit("modify", replacement);
race.app.workspace.emit("css-change");
changing.preview.loadFile();
assert.equal(pending.length, 9);
assert.equal(race.blobs.size, blobsBeforeUnload);
assert.deepEqual(race.unregistration, [["excalidraw"]]);
assert.equal(race.registry.embedByExtension.excalidraw, undefined);
assert.equal(race.app.vault.count() + race.app.workspace.count(), 0);
assert.equal(race.observers.size, 0);
assert.equal(new Set(race.revoked).size, race.blobs.size);
assert.equal(race.revoked.length, race.blobs.size, "Every created URL must be revoked once.");

// Multiple notes share one export. Removing one subscriber must leave work
// needed by another note alive; removing the last one cancels it.
const sharing = runtime();
let sharedResult = deferred();
sharing.useRenderer(() => sharedResult.promise);
sharing.start();
const sharedFile = new TFile("shared.excalidraw");
const first = sharing.mount(sharedFile), second = sharing.mount(sharedFile);
first.preview.loadFile();
second.preview.loadFile();
await settle();
assert.equal(sharing.renders.length, 1);
first.preview.unload();
assert.equal(sharing.renders[0].signal.aborted, false);
sharedResult.resolve("<svg>shared</svg>");
await settle();
assert.equal(first.container.firstElementChild, null);
assert.equal(await sharing.blobs.get(second.button.firstElementChild.src).text(), "<svg>shared</svg>");
first.preview.load();
first.preview.loadFile();
await settle();
assert.equal(sharing.renders.length, 1, "Remounting an unchanged file should use the bounded cache.");
assert.equal(first.container.firstElementChild.firstElementChild.tagName, "IMG");
sharedResult = deferred();
sharing.app.vault.emit("modify", sharedFile);
await settle();
assert.equal(sharing.renders.length, 2, "One modification must cause one shared export, even with unchanged file stats.");
first.preview.unload();
second.preview.unload();
assert.equal(sharing.renders[1].signal.aborted, true);
sharedResult.resolve("<svg>unneeded</svg>");
await settle();
assert.equal(sharing.blobs.size, 2);
sharing.app.vault.emit("delete", sharedFile);
first.preview.load();
first.preview.loadFile();
await settle();
assert.match(first.container.firstElementChild.textContent, /Drawing missing/);
assert.equal(sharing.renders.length, 2);
const recreated = new TFile(sharedFile.path);
sharedResult = Promise.resolve("<svg>replacement</svg>");
sharing.useRenderer(() => sharedResult);
sharing.app.vault.emit("create", recreated);
await settle();
assert.equal(sharing.renders.at(-1).file, recreated);
sharing.unload();
assert.equal(first.container.childNodes.length, 0, "A reused component must still be included in plugin unload cleanup.");
assert.equal(sharing.app.vault.count() + sharing.app.workspace.count(), 0);
assert.equal(sharing.revoked.length, sharing.blobs.size);

// Two exports may run at once. Repeated edits to a queued drawing keep only
// its newest version; unloading a queued preview prevents its export entirely.
const queued = runtime();
const work = [];
queued.useRenderer((file, dark, signal) => {
  const result = deferred();
  work.push({ file, signal, ...result });
  return result.promise;
});
queued.start();
const queueViews = Array.from({ length: 4 }, (_, index) => queued.mount(new TFile(`queue-${index}.excalidraw`)));
for (const entry of queueViews) entry.preview.loadFile();
await settle();
assert.equal(work.length, 2);
for (let index = 0; index < 10; index++) queued.app.vault.emit("modify", queueViews[2].file);
queueViews[3].preview.unload();
await settle();
assert.equal(work.length, 2);
work[0].resolve("<svg>first</svg>");
await settle();
assert.equal(work.length, 3);
assert.equal(work[2].file, queueViews[2].file);
work[1].resolve("<svg>second</svg>");
work[2].resolve("<svg>latest</svg>");
await settle();
assert.equal(work.length, 3, "Obsolete and unloaded queued versions must not reach the exporter.");
assert.equal(queueViews[2].button.firstElementChild.tagName, "IMG");
queued.unload();

// The cache keeps at most 20 recently used file/theme variants. It also limits
// retained text and skips a single SVG larger than its whole memory budget.
const bounded = runtime();
bounded.start();
const recentFiles = Array.from({ length: 21 }, (_, index) => new TFile(`cache-${index}.excalidraw`));
async function displayThenUnload(host, file) {
  const entry = host.mount(file);
  entry.preview.loadFile();
  await settle();
  assert.equal(entry.button.firstElementChild.tagName, "IMG");
  entry.preview.unload();
}
for (const file of recentFiles) await displayThenUnload(bounded, file);
assert.equal(bounded.renders.length, 21);
await displayThenUnload(bounded, recentFiles[20]);
assert.equal(bounded.renders.length, 21);
await displayThenUnload(bounded, recentFiles[0]);
assert.equal(bounded.renders.length, 22, "The oldest completed entry must be evicted.");
bounded.unload();

const memory = runtime();
memory.useRenderer(async () => "s".repeat(768 * 1024)); // 1.5 MiB UTF-16 text.
memory.start();
const memoryFiles = [new TFile("memory-a.excalidraw"), new TFile("memory-b.excalidraw"), new TFile("memory-c.excalidraw")];
for (const file of memoryFiles) await displayThenUnload(memory, file);
await displayThenUnload(memory, memoryFiles[2]);
assert.equal(memory.renders.length, 3);
await displayThenUnload(memory, memoryFiles[0]);
assert.equal(memory.renders.length, 4, "The text budget must evict an entry before the count limit is reached.");
memory.useRenderer(async () => "s".repeat(2 * 1024 * 1024 + 1));
const large = new TFile("large.excalidraw");
await displayThenUnload(memory, large);
await displayThenUnload(memory, large);
assert.equal(memory.renders.length, 6, "An oversized SVG may be displayed but must not remain cached.");
memory.unload();

// Failed exports are not cached; a deliberate retry can recover unchanged data.
const retry = runtime();
retry.useRenderer(async () => { throw new Error("Temporary read error"); });
retry.start();
const retryView = retry.mount();
retryView.preview.loadFile();
await settle();
assert.match(retryView.button.textContent, /Temporary read error/);
retry.useRenderer(async () => "<svg>recovered</svg>");
retryView.preview.loadFile();
await settle();
assert.equal(retry.renders.length, 2);
assert.equal(retryView.button.firstElementChild.tagName, "IMG");
retry.unload();

// Light and dark results are distinct, but switching back can reuse a result.
// File stats also detect a change when a host reload arrives before its event.
const themes = runtime();
themes.start();
const themed = themes.mount();
themed.preview.loadFile();
await settle();
themes.doc.body.classList.add("theme-dark");
themes.app.workspace.emit("css-change");
await settle();
assert.equal(themes.renders.length, 2);
assert.deepEqual(themes.renders.map(entry => entry.dark), [false, true]);
themes.doc.body.classList.remove("theme-dark");
themes.app.workspace.emit("css-change");
await settle();
assert.equal(themes.renders.length, 2);
themed.file.stat.mtime++;
themed.preview.loadFile();
await settle();
assert.equal(themes.renders.length, 3);
themes.unload();

console.log("Drawing embeds: lifecycle, shared exports, bounded cache, cancellation, refresh and dimensions passed.");
