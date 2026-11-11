import { Component, Notice, TFile, type App, type Plugin } from "obsidian";
import { DrawingPreviewCache, type PreviewRenderer } from "./drawing-preview-cache";
export type { PreviewRenderer } from "./drawing-preview-cache";

// Native embeds use an internal Obsidian API.
interface EmbedContext {
  containerEl: HTMLElement;
  sourcePath?: string;
}

type EmbedCreator = (context: EmbedContext, file: TFile, subpath?: string) => DrawingEmbed;
interface EmbedRegistry {
  embedByExtension: Record<string, unknown>;
  registerExtensions(extensions: string[], creator: EmbedCreator): void;
  unregisterExtensions(extensions: string[]): void;
}

export function registerDrawingEmbeds(plugin: Plugin, render: PreviewRenderer): void {
  const registry = (plugin.app as App & { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry || typeof registry.registerExtensions !== "function" ||
    typeof registry.unregisterExtensions !== "function" || !registry.embedByExtension) {
    new Notice("Drawing previews are unavailable in this version of Obsidian. Drawing files can still be opened.");
    return;
  }
  if (registry.embedByExtension.excalidraw) {
    new Notice("Another plugin already handles Excalidraw previews.");
    return;
  }

  const cache = new DrawingPreviewCache(render);
  // Update after every file change.
  const invalidate = (file: unknown): void => { if (file instanceof TFile) cache.invalidate(file); };
  plugin.registerEvent(plugin.app.vault.on("modify", invalidate));
  plugin.registerEvent(plugin.app.vault.on("rename", invalidate));
  plugin.registerEvent(plugin.app.vault.on("delete", invalidate));
  const previews = new Set<DrawingEmbed>();
  const creator: EmbedCreator = (context, file) => {
    const preview = new DrawingEmbed(plugin.app, context, file, cache,
      active => { if (active) previews.add(preview); else previews.delete(preview); });
    return preview;
  };
  registry.registerExtensions(["excalidraw"], creator);
  plugin.register(() => {
    if (registry.embedByExtension.excalidraw === creator) {
      registry.unregisterExtensions(["excalidraw"]);
    }
    cache.dispose();
    for (const preview of [...previews]) preview.unload();
    previews.clear();
  });
}

export class DrawingEmbed extends Component {
  private generation = 0;
  private stopped = true;
  private missing = false;
  private requestedVersion: string | null = null;
  private pending: AbortController | null = null;
  private objectUrl: string | null = null;
  private button: HTMLButtonElement | null = null;
  private image: HTMLImageElement | null = null;

  constructor(
    private readonly app: App,
    private readonly context: EmbedContext,
    private file: TFile,
    private readonly cache: DrawingPreviewCache,
    private readonly setActive: (active: boolean) => void
  ) {
    super();
  }

  onload(): void {
    if (this.cache.disposed) return;
    this.stopped = false;
    this.requestedVersion = null;
    this.setActive(true);

    const current = this.app.vault.getAbstractFileByPath(this.file.path);
    this.missing = !(current instanceof TFile);
    if (current instanceof TFile) this.file = current;
    const container = this.context.containerEl;
    const doc = container.ownerDocument;
    container.classList.add("just-simple-excalidraw-embed");
    this.button = doc.createElement("button");
    this.button.type = "button";
    this.button.className = "just-simple-excalidraw-preview";
    container.replaceChildren(this.button);
    this.registerDomEvent(this.button, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(this.file.path, this.context.sourcePath ?? "", "tab")
        .catch((error: unknown) => new Notice(`Could not open drawing: ${error instanceof Error ? error.message : String(error)}`));
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file === this.file) this.loadFile();
    }));
    this.registerEvent(this.app.vault.on("rename", (file) => {
      if (file === this.file) this.loadFile();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file === this.file) {
        this.missing = true;
        this.requestedVersion = null;
        this.pending?.abort();
        this.pending = null;
        ++this.generation;
        this.showMessage("Drawing missing. Click to create it.");
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.path === this.file.path) {
        this.file = file;
        this.missing = false;
        this.loadFile();
      }
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.loadFile()));

    // Use the preview window for popouts.
    const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer(() => this.applySize());
    observer.observe(container, { attributes: true, attributeFilter: ["width", "height"] });
    this.register(() => observer.disconnect());
    if (this.missing) this.showMessage("Drawing missing. Click to create it.");
  }

  loadFile(): void {
    if (this.stopped || this.cache.disposed || this.missing) return;
    const dark = this.context.containerEl.ownerDocument.body.classList.contains("theme-dark");
    const version = `${this.cache.version(this.file)}\0${dark}`;
    if (version === this.requestedVersion) return;
    this.requestedVersion = version;
    const generation = ++this.generation;
    this.pending?.abort();
    const pending = this.pending = new AbortController();

    queueMicrotask(() => {
      if (!pending.signal.aborted && !this.stopped && !this.missing) void this.refresh(generation, dark, pending);
    });
  }

  // Frame links show the whole drawing.
  setSubpath(_subpath: string): void { this.loadFile(); }

  onunload(): void {
    this.stopped = true;
    this.pending?.abort();
    this.pending = null;
    this.requestedVersion = null;
    ++this.generation;
    this.revokeImage();
    this.button?.remove();
    this.button = null;
    this.context.containerEl.classList.remove("just-simple-excalidraw-embed");
    this.setActive(false);
  }

  private async refresh(generation: number, dark: boolean, pending: AbortController): Promise<void> {
    const button = this.button;
    if (!button) return;
    button.title = `Open ${this.file.name}`;
    button.setAttribute("aria-label", `Open ${this.file.name}`);
    button.setAttribute("aria-busy", "true");
    if (!button.childNodes.length) button.textContent = "Loading drawing…";
    try {
      const svg = await this.cache.get(this.file, dark, pending.signal);
      if (this.stopped || this.missing || pending.signal.aborted || generation !== this.generation) return;
      if (svg === null) {
        this.showMessage("Empty drawing. Click to edit.");
        return;
      }
      const win = this.context.containerEl.ownerDocument.defaultView ?? window;
      const url = win.URL.createObjectURL(new win.Blob([svg], { type: "image/svg+xml" }));
      const image = this.context.containerEl.ownerDocument.createElement("img");
      image.alt = this.file.basename;
      image.draggable = false;
      image.src = url;
      // Show SVG as an image, not HTML.
      this.revokeImage();
      this.objectUrl = url;
      this.image = image;
      button.replaceChildren(image);
      button.removeAttribute("aria-busy");
      this.applySize();
    } catch (error) {
      if (this.stopped || this.missing || pending.signal.aborted || generation !== this.generation) return;
      this.requestedVersion = null;
      this.showMessage(`Cannot preview this drawing. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  private showMessage(message: string): void {
    this.revokeImage();
    if (this.button) {
      this.button.textContent = message;
      this.button.removeAttribute("aria-busy");
    }
  }

  private applySize(): void {
    if (!this.image) return;
    for (const dimension of ["width", "height"] as const) {
      const value = this.context.containerEl.getAttribute(dimension) ?? "";
      this.image.style[dimension] = /^\d+$/.test(value) && Number(value) > 0
        ? `${Math.min(Number(value), 10000)}px` : "";
    }
  }

  private revokeImage(): void {
    if (this.objectUrl) {
      const win = this.context.containerEl.ownerDocument.defaultView ?? window;
      win.URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.image = null;
  }
}
