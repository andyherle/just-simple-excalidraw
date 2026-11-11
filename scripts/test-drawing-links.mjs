import assert from "node:assert/strict";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.__drawingLinkNotices = [];
const bundle = await build({
  absWorkingDir: projectDirectory,
  entryPoints: ["src/drawing-links.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [{
    name: "mock-obsidian",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
      build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
        contents: `
          export class TFile {
            constructor(path) {
              this.path = path;
              this.name = path.split("/").pop();
              this.extension = this.name.split(".").pop();
            }
          }
          export class TFolder { constructor(path) { this.path = path; } }
          export class Notice { constructor(message) { globalThis.__drawingLinkNotices.push(message); } }
          globalThis.__drawingLinkTFile = TFile;
          globalThis.__drawingLinkTFolder = TFolder;
        `,
        loader: "js"
      }));
    }
  }]
});
const { registerDrawingLinks, getDrawingTargetPath } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const TFile = globalThis.__drawingLinkTFile;
const TFolder = globalThis.__drawingLinkTFolder;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function runtime({ creationGate = true } = {}) {
  const files = new Map();
  const events = new Map();
  const commands = [];
  const cleanups = [];
  const opened = [];
  const openOptions = [];
  const delegated = [];
  const created = [];
  const preferredParentCalls = [];
  const creationGateCalls = [];
  let waitToCreate;
  const workspace = {
    activeLeaf: { id: "source-leaf" },
    getLeaf(newLeaf) {
      assert.equal(newLeaf, false, "Only the current-pane destination needs to be captured before creation.");
      return this.activeLeaf;
    },
    on(name, callback) { events.set(name, callback); return {}; },
    async openLinkText(...args) { delegated.push({ receiver: this, args }); }
  };
  const original = workspace.openLinkText;
  const app = {
    workspace,
    vault: { getAbstractFileByPath(path) { return files.get(path) ?? null; } },
    metadataCache: {
      getFirstLinkpathDest(target) { return files.get(target) instanceof TFile ? files.get(target) : null; },
      fileToLinktext(file) { return file.path; }
    },
    fileManager: {
      canCreateFileWithExt(extension, ...args) {
        creationGateCalls.push({ receiver: this, extension, args });
        return extension === "md";
      },
      getNewFileParent(source, target) {
        preferredParentCalls.push({ source, target });
        return { path: "Drawings" };
      }
    }
  };
  if (!creationGate) delete app.fileManager.canCreateFileWithExt;
  const originalCreationGate = app.fileManager.canCreateFileWithExt;
  const actions = {
    async createDrawing(parent, open = true) {
      created.push({ parent, open });
      if (waitToCreate) await waitToCreate.promise;
      const file = new TFile(`${parent ? `${parent}/` : ""}New drawing.excalidraw`);
      if (files.has(file.path)) throw new Error("Already exists");
      files.set(file.path, file);
      if (open) opened.push(file);
      return file;
    },
    async createDrawingAtPath(path) {
      created.push({ path });
      if (waitToCreate) await waitToCreate.promise;
      if (files.has(path)) throw new Error("Already exists");
      const file = new TFile(path);
      files.set(path, file);
      return file;
    },
    async openDrawing(file, ...options) { opened.push(file); openOptions.push(options); }
  };
  const plugin = {
    app,
    addCommand(command) { commands.push(command); },
    registerEvent() {},
    register(cleanup) { cleanups.push(cleanup); }
  };
  registerDrawingLinks(plugin, actions);
  return { app, files, events, commands, created, opened, openOptions, delegated, preferredParentCalls, original,
    creationGateCalls, originalCreationGate,
    unload: () => cleanups.forEach(cleanup => cleanup()),
    delay: () => (waitToCreate = deferred()) };
}

function menu() {
  const items = [];
  return {
    items,
    addItem(callback) {
      const item = {
        setTitle(title) { this.title = title; return this; },
        setIcon(icon) { this.icon = icon; return this; },
        onClick(callback) { this.click = callback; return this; }
      };
      callback(item);
      items.push(item);
    }
  };
}

function editor(text) {
  let value = text;
  let from = { line: 0, ch: text.length };
  let to = { ...from };
  function offset(position) {
    const lines = value.split("\n");
    return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
  }
  return {
    getDoc() { return this; },
    getValue() { return value; },
    setValue(next) { value = next; },
    getCursor(side) { return side === "from" ? from : to; },
    setSelection(a, b = a) { from = a; to = b; },
    lastLine() { return value.split("\n").length - 1; },
    getLine(line) { return value.split("\n")[line]; },
    replaceRange(replacement, start, end = start) {
      value = value.slice(0, offset(start)) + replacement + value.slice(offset(end));
    }
  };
}

const paths = runtime();
assert.equal(getDrawingTargetPath(paths.app, "diagram.excalidraw", "Notes/source.md"), "Drawings/diagram.excalidraw");
assert.deepEqual(paths.preferredParentCalls.at(-1), { source: "Notes/source.md", target: undefined });
assert.equal(getDrawingTargetPath(paths.app, "./diagram.excalidraw", "Notes/source.md"), "Notes/diagram.excalidraw");
assert.equal(getDrawingTargetPath(paths.app, "../diagram.excalidraw", "Notes/source.md"), "diagram.excalidraw");
assert.equal(getDrawingTargetPath(paths.app, "/Shared/diagram.excalidraw", "Notes/source.md"), "Shared/diagram.excalidraw");
assert.equal(getDrawingTargetPath(paths.app, "Shared/diagram.excalidraw#detail", "Notes/source.md"), "Shared/diagram.excalidraw");
assert.throws(() => getDrawingTargetPath(paths.app, "../../diagram.excalidraw", "Notes/source.md"), /leaves this vault/);
assert.throws(() => getDrawingTargetPath(paths.app, "bad\\diagram.excalidraw", "Notes/source.md"), /forward slashes/);
assert.equal(getDrawingTargetPath(paths.app, "note.md", "Notes/source.md"), null);
assert.equal(getDrawingTargetPath(paths.app, "https://example.com/diagram.excalidraw", "Notes/source.md"), null);

const links = runtime();
const viewState = { active: false };
await links.app.workspace.openLinkText("note", "Notes/source.md", "split", viewState);
await links.app.workspace.openLinkText("https://example.com/diagram.excalidraw", "Notes/source.md", true);
assert.deepEqual(links.delegated[0].args, ["note", "Notes/source.md", "split", viewState]);
assert.equal(links.delegated[0].receiver, links.app.workspace);
assert.equal(links.created.length, 0);

const sourceResolved = runtime();
const sourceDrawing = new TFile("Projects/sketch.excalidraw");
sourceResolved.files.set(sourceDrawing.path, sourceDrawing);
sourceResolved.files.set("Elsewhere/sketch.excalidraw", new TFile("Elsewhere/sketch.excalidraw"));
const resolutionCalls = [];
sourceResolved.app.metadataCache.getFirstLinkpathDest = (target, sourcePath) => {
  resolutionCalls.push({ target, sourcePath });
  return target === "sketch.excalidraw" && sourcePath === "Projects/note.md" ? sourceDrawing : null;
};
await sourceResolved.app.workspace.openLinkText("sketch.excalidraw", "Projects/note.md", "split", viewState);
assert.deepEqual(resolutionCalls, [{ target: "sketch.excalidraw", sourcePath: "Projects/note.md" }]);
assert.deepEqual(sourceResolved.delegated[0].args, ["sketch.excalidraw", "Projects/note.md", "split", viewState]);
assert.equal(sourceResolved.created.length, 0);
assert.equal(sourceResolved.preferredParentCalls.length, 0);
const existing = new TFile("exists.excalidraw");
links.files.set(existing.path, existing);
await links.app.workspace.openLinkText(existing.path, "Notes/source.md", true, viewState);
assert.deepEqual(links.delegated.at(-1).args, [existing.path, "Notes/source.md", true, viewState]);
assert.equal(links.created.length, 0);

const delayed = links.delay();
const first = links.app.workspace.openLinkText("diagram.excalidraw", "Notes/source.md");
const second = links.app.workspace.openLinkText("diagram.excalidraw", "Notes/source.md");
assert.equal(links.created.length, 1, "Concurrent clicks must create one drawing.");
assert.deepEqual(links.created[0], { path: "Drawings/diagram.excalidraw" });
delayed.resolve();
await Promise.all([first, second]);
assert.equal(links.files.has("Drawings/diagram.excalidraw.md"), false);
assert.equal(links.opened[0], links.opened[1]);
assert.deepEqual(links.openOptions, [
  [false, undefined, links.app.workspace.activeLeaf],
  [false, undefined, links.app.workspace.activeLeaf]
], "A new link uses the native current-pane default and preserves its destination.");

const focus = runtime();
const sourceLeaf = focus.app.workspace.activeLeaf;
const focusDelay = focus.delay();
const focusTask = focus.app.workspace.openLinkText("./focused.excalidraw", "Notes/source.md");
focus.app.workspace.activeLeaf = { id: "another-leaf" };
focusDelay.resolve();
await focusTask;
assert.equal(focus.openOptions[0][2], sourceLeaf, "A pane switch during creation must not replace the newly active note.");
assert.notEqual(focus.openOptions[0][2], focus.app.workspace.activeLeaf);

const split = runtime();
await split.app.workspace.openLinkText("./split.excalidraw", "Notes/source.md", "split", viewState);
assert.deepEqual(split.openOptions[0], ["split", viewState, undefined], "New drawings must retain pane and focus options.");

const lag = runtime();
lag.app.metadataCache.getFirstLinkpathDest = () => null;
lag.files.set("Drawings/diagram.excalidraw", new TFile("Drawings/diagram.excalidraw"));
await lag.app.workspace.openLinkText("diagram.excalidraw", "Notes/source.md", "window", viewState);
assert.equal(lag.created.length, 0);
assert.equal(lag.opened[0], lag.files.get("Drawings/diagram.excalidraw"));
assert.deepEqual(lag.openOptions[0], ["window", viewState, undefined], "Cache-lag files must retain the native open options.");

const race = runtime();
const raceDelay = race.delay();
const raceOpen = race.app.workspace.openLinkText("./race.excalidraw", "Notes/source.md");
const racedFile = new TFile("Notes/race.excalidraw");
race.files.set(racedFile.path, racedFile);
raceDelay.resolve();
await raceOpen;
assert.equal(race.opened[0], racedFile);

const bad = runtime();
bad.files.set("Drawings/folder.excalidraw", new TFolder("Drawings/folder.excalidraw"));
await bad.app.workspace.openLinkText("folder.excalidraw", "Notes/source.md");
await bad.app.workspace.openLinkText("../../outside.excalidraw", "Notes/source.md");
assert.equal(bad.created.length, 0);
assert.equal(bad.delegated.length, 0, "A failed drawing creation must not fall through to .md creation.");

const insert = runtime();
const source = new TFile("Notes/source.md");
insert.files.set(source.path, source);
const noteEditor = editor("Diagram: ");
const info = { file: source, editor: noteEditor };
const context = menu();
insert.events.get("editor-menu")(context, noteEditor, info);
assert.equal(context.items[0].title, "Create new drawing and embed");
await context.items[0].click();
assert.equal(noteEditor.getValue(), "Diagram: ![[Drawings/New drawing.excalidraw]]");
assert.deepEqual(insert.created[0], { parent: "Drawings", open: false });
assert.deepEqual(insert.preferredParentCalls[0], { source: "Notes/source.md", target: undefined }, "Use the configured new-note folder without advertising an unregistered file creator.");
assert.equal(insert.opened.length, 1);
assert.deepEqual(insert.openOptions[0], [], "Create-and-embed retains the drawing action's new-tab default.");
assert.equal(insert.commands[0].editorCheckCallback(true, noteEditor, info), true);
assert.equal(insert.commands[0].editorCheckCallback(true, noteEditor, { file: new TFile("x.excalidraw") }), false);

const changed = runtime();
changed.files.set(source.path, source);
const changedEditor = editor("original");
const changedInfo = { file: source, editor: changedEditor };
const changedMenu = menu();
changed.events.get("editor-menu")(changedMenu, changedEditor, changedInfo);
const changedDelay = changed.delay();
const creatingEmbed = changedMenu.items[0].click();
changedEditor.setValue("my new text");
changedEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
changedDelay.resolve();
await creatingEmbed;
assert.equal(changedEditor.getValue(), "my new text\n![[Drawings/New drawing.excalidraw]]\n", "Pending creation must not overwrite new text or selection.");

const switched = runtime();
switched.files.set(source.path, source);
const switchedEditor = editor("original");
const switchedInfo = { file: source, editor: switchedEditor };
const switchedMenu = menu();
switched.events.get("editor-menu")(switchedMenu, switchedEditor, switchedInfo);
const switchedDelay = switched.delay();
const switchTask = switchedMenu.items[0].click();
switchedInfo.file = new TFile("Other.md");
switchedEditor.setValue("different note");
switchedDelay.resolve();
await switchTask;
assert.equal(switchedEditor.getValue(), "different note");
assert.equal(switched.opened.length, 0);

const folder = runtime();
const folderMenu = menu();
folder.events.get("file-menu")(folderMenu, new TFolder("Sketches"));
await folderMenu.items[0].click();
assert.deepEqual(folder.created[0], { parent: "Sketches", open: true });
const fileMenu = menu();
folder.events.get("file-menu")(fileMenu, source);
assert.equal(fileMenu.items.length, 0);

const clean = runtime();
assert.equal(clean.app.fileManager.canCreateFileWithExt("excalidraw"), true, "The host must attach a missing-drawing embed click handler.");
assert.equal(clean.creationGateCalls.length, 0, "Only the exact supported extension bypasses the native gate.");
assert.equal(clean.app.fileManager.canCreateFileWithExt("md", "extra"), true);
assert.deepEqual(clean.creationGateCalls[0], { receiver: clean.app.fileManager, extension: "md", args: ["extra"] });
assert.equal(clean.app.fileManager.canCreateFileWithExt("png"), false);
assert.equal(clean.app.fileManager.canCreateFileWithExt("EXCALIDRAW"), false);
clean.unload();
assert.equal(clean.app.workspace.openLinkText, clean.original);
assert.equal(clean.app.fileManager.canCreateFileWithExt, clean.originalCreationGate);
assert.equal(clean.app.fileManager.canCreateFileWithExt("excalidraw"), false);
await clean.app.workspace.openLinkText("after.excalidraw", "Notes/source.md");
assert.equal(clean.created.length, 0);

const layered = runtime();
const installed = layered.app.workspace.openLinkText;
const otherWrapper = function (...args) { return installed.apply(this, args); };
layered.app.workspace.openLinkText = otherWrapper;
const installedGate = layered.app.fileManager.canCreateFileWithExt;
const otherGate = function (...args) { return installedGate.apply(this, args); };
layered.app.fileManager.canCreateFileWithExt = otherGate;
layered.unload();
assert.equal(layered.app.workspace.openLinkText, otherWrapper, "Unload must preserve wrappers installed later.");
assert.equal(layered.app.fileManager.canCreateFileWithExt, otherGate, "Unload must preserve a later gate wrapper.");
assert.equal(layered.app.fileManager.canCreateFileWithExt("excalidraw"), false, "An inactive gate must delegate to the native behavior.");
assert.equal(layered.creationGateCalls.length, 1);
await layered.app.workspace.openLinkText("after.excalidraw", "Notes/source.md");
assert.equal(layered.created.length, 0);
assert.equal(layered.delegated.length, 1);

const absentGate = runtime({ creationGate: false });
assert.equal(absentGate.app.fileManager.canCreateFileWithExt, undefined, "Do not invent an absent host API.");
await absentGate.app.workspace.openLinkText("still-works.excalidraw", "Notes/source.md");
assert.equal(absentGate.created.length, 1, "Normal drawing links work when the private embed gate is unavailable.");
absentGate.unload();
assert.equal(absentGate.app.fileManager.canCreateFileWithExt, undefined);

const pendingUnload = runtime();
const unloadDelay = pendingUnload.delay();
const unloadTask = pendingUnload.app.workspace.openLinkText("pending.excalidraw", "Notes/source.md");
pendingUnload.unload();
unloadDelay.resolve();
await unloadTask;
assert.equal(pendingUnload.opened.length, 0);

console.log("Drawing link tests passed: paths, delegation, create-once, races, source identity, insertion, menus and unload.");
