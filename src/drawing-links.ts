import { Notice, TFile, TFolder } from "obsidian";
import type { App, Editor, EditorPosition, MarkdownFileInfo, OpenViewState, PaneType, Plugin, WorkspaceLeaf } from "obsidian";

export interface DrawingActions {
  createDrawing(parentPath?: string, open?: boolean): Promise<TFile>;
  createDrawingAtPath(path: string): Promise<TFile>;
  openDrawing(file: TFile, newLeaf?: PaneType | boolean, openViewState?: OpenViewState, targetLeaf?: WorkspaceLeaf): Promise<void>;
}

type FileCreationGate = (extension: string, ...args: unknown[]) => boolean;
type FileManagerWithCreationGate = App["fileManager"] & { canCreateFileWithExt?: FileCreationGate };

function drawingLinkPath(linktext: string): string | null {
  const path = linktext.split(/[|#]/, 1)[0].trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) return null;
  return /\.excalidraw$/i.test(path) ? path : null;
}

function vaultPath(path: string): string {
  if (/[\\\u0000-\u001f:[\]|#]/.test(path)) {
    throw new Error("Use a drawing path inside this vault, with forward slashes.");
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("The drawing path leaves this vault.");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (!parts.length) throw new Error("Enter a drawing filename.");
  return parts.join("/");
}

/** New drawing paths do not add .md. */
export function getDrawingTargetPath(app: App, linktext: string, sourcePath: string): string | null {
  const target = drawingLinkPath(linktext);
  if (!target) return null;
  if (target.startsWith("./") || target.startsWith("../")) {
    const parent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    return vaultPath(`${parent ? `${parent}/` : ""}${target}`);
  }
  if (target.includes("/")) return vaultPath(target);

  const parent = app.fileManager.getNewFileParent(sourcePath).path;
  return vaultPath(`${parent && parent !== "/" ? `${parent}/` : ""}${target}`);
}

function samePosition(a: EditorPosition, b: EditorPosition): boolean {
  return a.line === b.line && a.ch === b.ch;
}

function reportError(error: unknown): void {
  new Notice(`Could not create the drawing. ${error instanceof Error ? error.message : String(error)}`);
}

export function registerDrawingLinks(plugin: Plugin, actions: DrawingActions): void {
  const { app } = plugin;
  let active = true;
  const creating = new Map<string, Promise<TFile>>();

  // Enable clicks on missing drawing embeds.
  const fileManager = app.fileManager as FileManagerWithCreationGate;
  const previousCreationGate = fileManager?.canCreateFileWithExt;
  let creationGate: FileCreationGate | undefined;
  if (typeof previousCreationGate === "function") {
    creationGate = function (this: FileManagerWithCreationGate, extension, ...args) {
      return active && extension === "excalidraw" ? true : previousCreationGate.call(this, extension, ...args);
    };
    fileManager.canCreateFileWithExt = creationGate;
  }

  const createAndEmbed = async (editor: Editor, info: MarkdownFileInfo): Promise<void> => {
    const sourceFile = info.file;
    if (!active || !sourceFile || sourceFile.extension !== "md") return;
    const sourcePath = sourceFile.path;
    const document = editor.getDoc();
    const before = editor.getValue();
    const from = { ...editor.getCursor("from") };
    const to = { ...editor.getCursor("to") };
    try {
      const parent = app.fileManager.getNewFileParent(sourcePath).path;
      const file = await actions.createDrawing(parent === "/" ? "" : parent, false);
      // Do not insert into another note.
      if (!active || info.file !== sourceFile || sourceFile.path !== sourcePath ||
          (info.editor && info.editor !== editor) || editor.getDoc() !== document ||
          app.vault.getAbstractFileByPath(sourcePath) !== sourceFile) {
        new Notice(`Created ${file.name}. The source note changed, so no embed was inserted.`);
        return;
      }

      const link = app.metadataCache.fileToLinktext(file, sourcePath, false);
      const embed = `![[${link}]]`;
      if (editor.getValue() === before && samePosition(editor.getCursor("from"), from) &&
          samePosition(editor.getCursor("to"), to)) {
        editor.replaceRange(embed, from, to);
      } else {
        // Keep note changes made during creation.
        const line = editor.lastLine();
        const end = { line, ch: editor.getLine(line).length };
        editor.replaceRange(`${editor.getValue().endsWith("\n") || !editor.getValue() ? "" : "\n"}${embed}\n`, end);
        new Notice("The note changed. The drawing embed was added at the end.");
      }
      await actions.openDrawing(file);
    } catch (error) {
      reportError(error);
    }
  };

  plugin.addCommand({
    id: "create-and-embed-excalidraw-drawing",
    name: "Create new drawing and embed",
    editorCheckCallback: (checking, editor, info) => {
      if (!info.file || info.file.extension !== "md") return false;
      if (!checking) void createAndEmbed(editor, info);
      return true;
    }
  });

  plugin.registerEvent(app.workspace.on("editor-menu", (menu, editor, info) => {
    if (!info.file || info.file.extension !== "md") return;
    menu.addItem(item => item.setTitle("Create new drawing and embed").setIcon("pencil-ruler")
      .onClick(() => createAndEmbed(editor, info)));
  }));

  plugin.registerEvent(app.workspace.on("file-menu", (menu, file) => {
    if (!(file instanceof TFolder)) return;
    menu.addItem(item => item.setTitle("Create new drawing").setIcon("pencil-ruler")
      .onClick(async () => {
        if (!active) return;
        try { await actions.createDrawing(file.path === "/" ? "" : file.path); }
        catch (error) { reportError(error); }
      }));
  }));

  const previousOpenLink = app.workspace.openLinkText;
  const openLink: typeof previousOpenLink = async function (this: App["workspace"], linktext, sourcePath, ...options) {
    const target = drawingLinkPath(linktext);
    if (!active || !target || app.metadataCache.getFirstLinkpathDest(target, sourcePath)) {
      return previousOpenLink.call(this, linktext, sourcePath, ...options);
    }
    try {
      const path = getDrawingTargetPath(app, target, sourcePath)!;
      const newLeaf = options[0] ?? false;
      // Keep the chosen pane.
      const targetLeaf = newLeaf === false ? app.workspace.getLeaf(false) : undefined;
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing && !(existing instanceof TFile)) throw new Error("A folder already uses this drawing path.");
      if (existing instanceof TFile) {
        await actions.openDrawing(existing, newLeaf, options[1], targetLeaf);
        return;
      }
      let pending = creating.get(path);
      if (!pending) {
        pending = (async () => {

          const current = app.vault.getAbstractFileByPath(path);
          if (current instanceof TFile) return current;
          if (current) throw new Error("A folder already uses this drawing path.");
          try { return await actions.createDrawingAtPath(path); }
          catch (error) {
            const raced = app.vault.getAbstractFileByPath(path);
            if (raced instanceof TFile) return raced;
            throw error;
          }
        })();
        creating.set(path, pending);
      }
      let file: TFile;
      try { file = await pending; }
      finally { if (creating.get(path) === pending) creating.delete(path); }
      if (active) await actions.openDrawing(file, newLeaf, options[1], targetLeaf);
    } catch (error) {
      // Do not let Obsidian add .md.
      reportError(error);
    }
  };
  app.workspace.openLinkText = openLink;
  plugin.register(() => {
    active = false;
    // Do not remove another plugin's wrapper.
    if (app.workspace.openLinkText === openLink) app.workspace.openLinkText = previousOpenLink;
    if (creationGate && fileManager.canCreateFileWithExt === creationGate) {
      fileManager.canCreateFileWithExt = previousCreationGate;
    }
  });
}
