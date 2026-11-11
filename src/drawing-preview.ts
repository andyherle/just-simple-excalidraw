import type { App } from "obsidian";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { PreviewRenderer } from "./drawing-preview-cache";
import { checkFileSize, checkScene, PREVIEW_LIMITS } from "./preview-limits";

type Library = typeof import("@excalidraw/excalidraw");

export function createPreviewRenderer(app: App, library: Library): PreviewRenderer {
  return async (file, dark, signal) => {
    checkFileSize(file.stat.size);
    signal?.throwIfAborted();
    // Do not retain the source JSON in the vault's read cache.
    const contents = await app.vault.read(file);
    signal?.throwIfAborted();
    checkFileSize(contents.length);
    const parsed: unknown = JSON.parse(contents);
    checkScene(parsed);
    // Imported fields are checked above. Excalidraw restores missing defaults.
    const scene = parsed as unknown as ExcalidrawInitialDataState;
    const elements = library.getNonDeletedElements(library.restoreElements(scene.elements, null));
    if (!elements.length) return null;
    signal?.throwIfAborted();
    const svg = await library.exportToSvg({
      elements,
      appState: { ...scene.appState, exportBackground: false, exportEmbedScene: false, exportWithDarkMode: dark },
      files: scene.files ?? {},
      exportPadding: 12,
      renderEmbeddables: false
    });
    signal?.throwIfAborted();
    // Keep the viewBox. Cap the browser's initial raster size.
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error("Invalid preview size.");
    const scale = Math.min(1, PREVIEW_LIMITS.outputSide / Math.max(width, height));
    svg.setAttribute("width", String(Math.max(1, Math.round(width * scale))));
    svg.setAttribute("height", String(Math.max(1, Math.round(height * scale))));
    const text = new XMLSerializer().serializeToString(svg);
    if (text.length > PREVIEW_LIMITS.svgCharacters) throw new Error("Preview too large. Open the drawing to edit.");
    return text;
  };
}
