import type { App, TFile } from "obsidian";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";

export type PreviewRenderer = (file: TFile, dark: boolean, signal?: AbortSignal) => Promise<string | null>;

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

/** Preview limits. These do not change the saved drawing. */
export const PREVIEW_LIMITS = {
  fileBytes: 12 * 1024 * 1024,
  elements: 5000,
  points: 50000,
  textCharacters: 200000,
  images: 32,
  imageBytes: 8 * 1024 * 1024,
  imagePixels: 16 * 1024 * 1024,
  totalPixels: 32 * 1024 * 1024,
  coordinate: 1000000,
  svgCharacters: 4 * 1024 * 1024,
  outputSide: 4096
} as const;

function fail(reason: string): never {
  throw new Error(`Preview skipped: ${reason}. Open the drawing to edit.`);
}

export function checkFileSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > PREVIEW_LIMITS.fileBytes) fail("file over 12 MiB");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read image dimensions without decoding the full image. */
export function imageSize(url: string): { width: number; height: number; bytes: number } {
  const comma = url.indexOf(",");
  if (comma < 0 || comma > 80 || !/^data:image\/(png|jpe?g|gif|webp);base64$/i.test(url.slice(0, comma))) {
    fail("use PNG, JPEG, GIF, or WebP images");
  }
  const bytes = Math.ceil((url.length - comma - 1) * 3 / 4);
  if (bytes > PREVIEW_LIMITS.imageBytes) fail("image data over 8 MiB");
  // The header is at most 64 KiB. Do not decode a large data URL here.
  let header: string;
  try { header = atob(url.slice(comma + 1, comma + 1 + 87380)); }
  catch { return fail("invalid image data"); }
  const b = (n: number): number => header.charCodeAt(n);
  const u16 = (n: number): number => b(n) * 256 + b(n + 1);
  const le16 = (n: number): number => b(n) + b(n + 1) * 256;
  const le24 = (n: number): number => le16(n) + b(n + 2) * 65536;
  const u32 = (n: number): number => u16(n) * 65536 + u16(n + 2);
  let width = 0, height = 0;
  if (header.startsWith("\x89PNG\r\n\x1a\n") && header.slice(12, 16) === "IHDR") {
    width = u32(16); height = u32(20);
  } else if (/^GIF8[79]a/.test(header)) {
    width = le16(6); height = le16(8);
  } else if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    const kind = header.slice(12, 16);
    if (kind === "VP8X") { width = 1 + le24(24); height = 1 + le24(27); }
    else if (kind === "VP8 " && header.slice(23, 26) === "\x9d\x01\x2a") {
      width = le16(26) & 16383; height = le16(28) & 16383;
    } else if (kind === "VP8L" && b(20) === 47) {
      width = 1 + ((b(21) | b(22) << 8) & 16383);
      height = 1 + ((b(22) >> 6 | b(23) << 2 | b(24) << 10) & 16383);
    }
  } else if (b(0) === 255 && b(1) === 216) {
    for (let at = 2; at + 8 < header.length;) {
      if (b(at++) !== 255) break;
      while (b(at) === 255) at++;
      const marker = b(at++);
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = u16(at);
      if (length < 2 || at + length > header.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = u16(at + 3); width = u16(at + 5); break;
      }
      at += length;
    }
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) fail("invalid image header");
  if (width > 8192 || height > 8192 || width * height > PREVIEW_LIMITS.imagePixels) fail("image resolution too large");
  return { width, height, bytes };
}

/** Validate before restoring elements or exporting SVG. */
export function checkScene(value: unknown): asserts value is {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files?: Record<string, { id: string; mimeType: string; dataURL: string }>;
} {
  if (!record(value) || !Array.isArray(value.elements) || !record(value.appState) ||
      value.files !== undefined && !record(value.files)) fail("invalid drawing");
  if (value.elements.length > PREVIEW_LIMITS.elements) fail("more than 5000 elements");
  let points = 0, text = 0, filledArea = 0;
  for (const element of value.elements) {
    if (!record(element) || typeof element.id !== "string" || typeof element.type !== "string") fail("invalid element");
    for (const key of ["x", "y", "width", "height", "angle", "strokeWidth", "fontSize"]) {
      const n = element[key];
      if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > PREVIEW_LIMITS.coordinate)) fail("invalid element size");
    }
    for (const key of ["width", "height"]) {
      if (typeof element[key] === "number" && Math.abs(element[key]) > 16384) fail("element too large");
    }
    if (typeof element.fontSize === "number" && (element.fontSize < 1 || element.fontSize > 1024)) fail("font size too large");
    if (typeof element.strokeWidth === "number" && (element.strokeWidth < 0.5 || element.strokeWidth > 32)) fail("unsupported stroke width");
    if (typeof element.roughness === "number" && (element.roughness < 0 || element.roughness > 10)) fail("unsupported roughness");
    if (["rectangle", "ellipse", "diamond"].includes(element.type) && element.fillStyle !== "solid" &&
        element.backgroundColor && element.backgroundColor !== "transparent") {
      filledArea += Math.abs(Number(element.width ?? 0) * Number(element.height ?? 0));
      if (filledArea > 16 * 1024 * 1024) fail("too much patterned fill");
    }
    if (element.points !== undefined) {
      if (!Array.isArray(element.points)) fail("invalid points");
      points += element.points.length;
      if (points > PREVIEW_LIMITS.points) fail("more than 50000 points");
      for (const point of element.points) {
        if (!Array.isArray(point) || point.length !== 2 || point.some(n =>
          typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > PREVIEW_LIMITS.coordinate)) fail("invalid point");
      }
    }
    for (const key of ["text", "originalText"]) {
      if (typeof element[key] === "string") text += element[key].length;
    }
    if (text > PREVIEW_LIMITS.textCharacters) fail("too much text");
  }
  let count = 0, bytes = 0, pixels = 0;
  for (const file of Object.values(value.files ?? {})) {
    if (++count > PREVIEW_LIMITS.images) fail("more than 32 images");
    if (!record(file) || typeof file.id !== "string" || typeof file.mimeType !== "string" || typeof file.dataURL !== "string") fail("invalid image");
    const size = imageSize(file.dataURL);
    bytes += size.bytes; pixels += size.width * size.height;
    if (bytes > PREVIEW_LIMITS.imageBytes || pixels > PREVIEW_LIMITS.totalPixels) fail("too much image data");
  }
}
