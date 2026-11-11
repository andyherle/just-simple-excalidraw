import { Component, Notice, TFile, type App, type Plugin } from "obsidian";

// Obsidian has no public API for custom file embeds. Keep this small adapter
// separate, check its shape, and never replace another plugin's renderer.
// The host uses this same registry in Reading view and Live Preview.
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

export type PreviewRenderer = (file: TFile, dark: boolean) => Promise<string | null>;

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

  const previews = new Set<DrawingEmbed>();
  const creator: EmbedCreator = (context, file) => {
    const preview = new DrawingEmbed(plugin.app, context, file, render, () => previews.delete(preview));
    previews.add(preview);
    return preview;
  };
  registry.registerExtensions(["excalidraw"], creator);
  plugin.register(() => {
    if (registry.embedByExtension.excalidraw === creator) {
      registry.unregisterExtensions(["excalidraw"]);
    }
    for (const preview of [...previews]) preview.unload();
    previews.clear();
  });
}

/** A read-only image. It never claims file ownership or saves a scene. */
export class DrawingEmbed extends Component {
  private generation = 0;
  private stopped = false;
  private objectUrl: string | null = null;
  private button: HTMLButtonElement | null = null;
  private image: HTMLImageElement | null = null;

  constructor(
    private readonly app: App,
    private readonly context: EmbedContext,
    private file: TFile,
    private readonly render: PreviewRenderer,
    private readonly disposed: () => void
  ) {
    super();
  }

  onload(): void {
    this.stopped = false;
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
        ++this.generation;
        this.showMessage("Drawing missing. Click to create it.");
      }
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.path === this.file.path) {
        this.file = file;
        this.loadFile();
      }
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.loadFile()));

    // Attribute changes do not require another SVG export. Use the owning
    // window so the same component works in desktop popout windows.
    const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
    const observer = new Observer(() => this.applySize());
    observer.observe(container, { attributes: true, attributeFilter: ["width", "height"] });
    this.register(() => observer.disconnect());
  }

  loadFile(): void {
    if (this.stopped) return;
    void this.refresh();
  }

  // Element/section selection is outside this prototype. A subpath still
  // displays the complete drawing and never changes its saved contents.
  setSubpath(_subpath: string): void { this.loadFile(); }

  onunload(): void {
    this.stopped = true;
    ++this.generation;
    this.revokeImage();
    this.button?.remove();
    this.button = null;
    this.context.containerEl.classList.remove("just-simple-excalidraw-embed");
    this.disposed();
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    const button = this.button;
    if (!button) return;
    button.title = `Open ${this.file.name}`;
    button.setAttribute("aria-label", `Open ${this.file.name}`);
    button.setAttribute("aria-busy", "true");
    if (!button.childNodes.length) button.textContent = "Loading drawing…";
    try {
      const dark = this.context.containerEl.ownerDocument.body.classList.contains("theme-dark");
      const svg = await this.render(this.file, dark);
      if (this.stopped || generation !== this.generation) return;
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
      // An SVG image does not execute scripts or open its embedded hyperlinks.
      // Do not append SVG markup to the Obsidian document.
      this.revokeImage();
      this.objectUrl = url;
      this.image = image;
      button.replaceChildren(image);
      button.removeAttribute("aria-busy");
      this.applySize();
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      this.showMessage(`Cannot preview this drawing. ${error instanceof Error ? error.message : String(error)}`);
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
