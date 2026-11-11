from pathlib import Path
import shutil, subprocess, sys
orig, dst = map(Path, sys.argv[1:])
def base_file(path):
    return subprocess.check_output(["git", "show", "HEAD:" + path], cwd=dst).decode()
# Keep tested rendering and cleanup; leave fork-only actions and release changes out.
for name in ['drawing-embeds.ts','drawing-preview-cache.ts','drawing-preview-visibility.ts']:
    shutil.copyfile(orig/'src'/name, dst/'src'/name)
# Keep limits beside the exporter they protect, not in another helper module.
limits=(orig/'src/preview-limits.ts').read_text()
renderer=(orig/'src/drawing-preview.ts').read_text()
renderer=renderer.replace('import type { App } from "obsidian";', 'import type { App, TFile } from "obsidian";')
renderer=renderer.replace('import type { PreviewRenderer } from "./drawing-preview-cache";\n', '')
renderer=renderer.replace('import { checkFileSize, checkScene, PREVIEW_LIMITS } from "./preview-limits";\n', '')
renderer=renderer.replace('type Library =', 'export type PreviewRenderer = (file: TFile, dark: boolean, signal?: AbortSignal) => Promise<string | null>;\n\ntype Library =')
(dst/'src/drawing-preview.ts').write_text(renderer+'\n'+limits)
cache=(dst/'src/drawing-preview-cache.ts').read_text().replace('export type PreviewRenderer = (file: TFile, dark: boolean, signal?: AbortSignal) => Promise<string | null>;', 'import type { PreviewRenderer } from "./drawing-preview";')
(dst/'src/drawing-preview-cache.ts').write_text(cache)
e=(dst/'src/drawing-embeds.ts').read_text()
e=e.replace('import { DrawingPreviewCache, type PreviewRenderer } from "./drawing-preview-cache";', 'import { DrawingPreviewCache } from "./drawing-preview-cache";\nimport { createPreviewRenderer } from "./drawing-preview";')
e=e.replace('import type { PreviewVisibility, PreviewWatch } from "./drawing-preview-visibility";\nexport type { PreviewRenderer } from "./drawing-preview-cache";', 'import { registerPreviewVisibility, type PreviewVisibility, type PreviewWatch } from "./drawing-preview-visibility";')
e=e.replace('registerDrawingEmbeds(plugin: Plugin, render: PreviewRenderer, watch?: PreviewVisibility)', 'registerDrawingEmbeds(plugin: Plugin, library: typeof import("@excalidraw/excalidraw"))')
e=e.replace('  const cache = new DrawingPreviewCache(render);', '  const cache = new DrawingPreviewCache(createPreviewRenderer(plugin.app, library));\n  const watch = registerPreviewVisibility(plugin);')
e=e.replace('export class DrawingEmbed', 'class DrawingEmbed')
e=e.replace('private readonly watch?: PreviewVisibility', 'private readonly watch: PreviewVisibility')
e=e.replace('    this.visible = !this.watch;\n    container.hidden = !this.visible;\n    if (this.watch) {', '    this.visible = false;\n    container.hidden = true;\n    {')
# No missing-file creation behavior in the upstream preview-only change.
e=e.replace('Drawing missing. Click to create.', 'Drawing missing.')
e=e.replace('      void this.app.workspace.openLinkText', '      if (this.missing) return;\n      void this.app.workspace.openLinkText')
(dst/'src/drawing-embeds.ts').write_text(e)
# The editor, autosave, file format and creation paths stay byte-for-byte unchanged.
s=base_file("main.ts").replace('import { fontMime, setCustomFont } from "./src/custom-font";', 'import { fontMime, setCustomFont } from "./src/custom-font";\nimport { registerDrawingEmbeds } from "./src/drawing-embeds";')
s=s.replace('    this.registerExtensions(["excalidraw"], VIEW_TYPE_EXCALIDRAW);','    this.registerExtensions(["excalidraw"], VIEW_TYPE_EXCALIDRAW);\n    registerDrawingEmbeds(this, drawingLibrary);')
(dst/'main.ts').write_text(s)
# Native editor modules must be supplied by Obsidian, not bundled twice.
s=base_file("esbuild.config.mjs").replace('external: ["obsidian", "electron", ...builtinModules]', 'external: ["obsidian", "electron", "@codemirror/view", ...builtinModules]')
(dst/'esbuild.config.mjs').write_text(s)
s=base_file("scripts/audit-release.mjs").replace('dependency !== "obsidian"', 'dependency !== "obsidian" && dependency !== "@codemirror/view"')
(dst/'scripts/audit-release.mjs').write_text(s)
# One new test replaces four separate suites. Existing regression tests are unchanged.
for name in ['test-file-isolation.mjs','test-theme.mjs','test-font-loading.mjs']:
    s=base_file("scripts/"+name).replace('const mocks = {', 'const mocks = {\n  "./src/drawing-embeds": "export const registerDrawingEmbeds = () => {};",',1)
    (dst/'scripts'/name).write_text(s)
s=base_file("package.json").replace('node scripts/test-font-loading.mjs"','node scripts/test-font-loading.mjs && node scripts/test-drawing-embeds.mjs"')
(dst/'package.json').write_text(s)
shutil.copyfile(orig/'src/styles.css',dst/'src/styles.css')
# Add only the user-facing explanation. Retain the author's README and voice.
s=base_file("README.md")
s=s.replace('It deliberately does **not** add Markdown embedding, OCR, AI, collaboration,', 'It deliberately does **not** add OCR, AI, collaboration,')
s=s.replace('- **Vault files:** it reads and writes only the `.excalidraw` file you open or\n  create in the vault.', '- **Vault files:** it reads drawings that you open or embed. It writes drawings\n  that you create or edit. Previews do not change drawing files.')
section='''### Drawing previews

Use `![[drawing.excalidraw]]` in a note. Add `|400` to set its width.
Click the preview to edit. It updates after a save and follows the note theme.
Previews hide in Source mode and while editing their links.

Drawings stay in one `.excalidraw` file. No extra image files are saved.
Large or unsupported drawings show a message instead of a preview.
Only raw `.excalidraw` files are supported, not `.excalidraw.md` or frame crops.

'''
s=s.replace('### One drawing, one editor',section+'### One drawing, one editor')
(dst/'README.md').write_text(s)

# Remove the optional-watcher scope; previews always use the editor watcher.
p=dst/'src/drawing-embeds.ts'
s=p.read_text().replace('    {\n      this.visibilityWatch = this.watch', '    this.visibilityWatch = this.watch')
start=s.index('    this.visibilityWatch = this.watch')
end=s.index('    this.registerDomEvent',start)
lines=s[start:end].splitlines()
lines=[lines[0]]+[line[2:] if line.startswith('      ') else line for line in lines[1:-1]]
p.write_text(s[:start]+'\n'.join(lines)+'\n'+s[end:])
shutil.copyfile(orig/'.github/review/test-drawing-embeds.mjs', dst/'scripts/test-drawing-embeds.mjs')
