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
    this.onunload?.();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}
class TFile {
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
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function runtime() {
  const page = documentFixture();
  const renders = [];
  const opened = [];
  const registration = [];
  const unregistration = [];
  const cleanups = [];
  const writes = [];
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
      ...events(),
      async create(...args) { writes.push(["create", ...args]); },
      async modify(...args) { writes.push(["modify", ...args]); },
      async delete(...args) { writes.push(["delete", ...args]); }
    },
    workspace: { ...events(), async openLinkText(...args) { opened.push(args); } }
  };
  const plugin = { app, register(cleanup) { cleanups.push(cleanup); } };
  return {
    ...page, app, registry, registration, unregistration, renders, opened, writes,
    start() {
      registerDrawingEmbeds(plugin, (file, dark) => {
        renders.push({ file, dark });
        return renderer(file, dark);
      });
    },
    useRenderer(next) { renderer = next; },
    mount(file = new TFile("Drawings/diagram.excalidraw")) {
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
race.app.vault.emit("modify", changing.file);
pending[1].resolve("<svg>new</svg>");
await settle();
const currentUrl = changing.button.firstElementChild.src;
pending[0].reject(new Error("stale read failed"));
await settle();
assert.equal(changing.button.firstElementChild.src, currentUrl);
assert.equal(race.blobs.size, 1);
changing.preview.loadFile();
changing.preview.loadFile();
pending[3].resolve("<svg>newest</svg>");
await settle();
pending[2].resolve("<svg>old</svg>");
await settle();
assert.equal(await race.blobs.get(changing.button.firstElementChild.src).text(), "<svg>newest</svg>");
assert.deepEqual(race.revoked, [currentUrl]);

// Deletion invalidates in-flight work. A newly created TFile at the same path
// replaces the old identity, and unrelated creations do not wake the preview.
changing.preview.loadFile();
const beforeDeleteUrl = changing.button.firstElementChild.src;
race.app.vault.emit("delete", changing.file);
assert.match(changing.button.textContent, /Drawing missing/);
assert.ok(race.revoked.includes(beforeDeleteUrl));
pending[4].resolve("<svg>deleted</svg>");
await settle();
assert.equal(changing.button.firstElementChild, null);
race.app.vault.emit("create", new TFile("Other/diagram.excalidraw"));
assert.equal(pending.length, 5);
const replacement = new TFile(changing.file.path);
race.app.vault.emit("create", replacement);
assert.equal(race.renders.at(-1).file, replacement);
pending[5].resolve("<svg>recreated</svg>");
await settle();
assert.equal(await race.blobs.get(changing.button.firstElementChild.src).text(), "<svg>recreated</svg>");
const countBeforeOldModify = pending.length;
race.app.vault.emit("modify", changing.file);
assert.equal(pending.length, countBeforeOldModify);

// Empty scenes and read errors stay visible as messages and release images.
const currentBeforeEmpty = changing.button.firstElementChild.src;
changing.preview.loadFile();
pending[6].resolve(null);
await settle();
assert.match(changing.button.textContent, /Empty drawing/);
assert.ok(race.revoked.includes(currentBeforeEmpty));
changing.preview.loadFile();
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

console.log("Drawing embed lifecycle, async refresh, registry ownership and dimensions passed.");
