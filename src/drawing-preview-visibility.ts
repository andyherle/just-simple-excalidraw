import { editorLivePreviewField, type Plugin } from "obsidian";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export type PreviewWatch = { refresh(): void; dispose(): void };
export type PreviewVisibility = (element: HTMLElement, change: (visible: boolean) => void) => PreviewWatch;

type Watch = { element: HTMLElement; change: (visible: boolean) => void; view: EditorView | null; visible?: boolean };

/** Find the source link for a native embed widget. */
export function embedRange(text: string, start: number, position: number): { from: number; to: number } | null {
  const pattern = /!\[\[[^\n]*?\]\]|!\[[^\]\n]*\]\((?:<[^>\n]+>|[^\n]*?)\)/g;
  let best: { from: number; to: number } | null = null;
  let distance = Infinity;
  for (const match of text.matchAll(pattern)) {
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    const from = start + match.index, to = from + match[0].length;
    const gap = Math.max(from - position, position - to, 0);
    if (gap < distance) { best = { from, to }; distance = gap; }
  }
  return best;
}

function canShow(watch: Watch): boolean {
  const { element, view } = watch;
  if (!view) return !element.closest(".markdown-source-view");
  if (!view.state.field(editorLivePreviewField, false)) return false;
  try {
    const at = Math.min(view.state.doc.length, view.posAtDOM(element));
    const line = view.state.doc.lineAt(at);
    const previous = at > 0 ? view.state.doc.lineAt(at - 1) : line;
    const range = embedRange(line.text, line.from, at) ?? embedRange(previous.text, previous.from, at);
    // Unknown host layout: keep the source line editable.
    const from = range?.from ?? line.from, to = range?.to ?? line.to;
    return !view.state.selection.ranges.some(selection => selection.empty
      ? selection.from >= from && selection.from <= to
      : selection.from < to && selection.to > from);
  } catch {
    return false;
  }
}

/** One editor listener. No timers, document scans, or new packages. */
export function registerPreviewVisibility(plugin: Plugin): PreviewVisibility {
  const watches = new Set<Watch>();
  const pending = new Set<Watch>();
  const byView = new Map<EditorView, Set<Watch>>();
  const scheduled = new WeakSet<EditorView>();
  let stopped = false;

  const notify = (watch: Watch): void => {
    const visible = canShow(watch);
    if (visible === watch.visible) return;
    watch.visible = visible;
    watch.change(visible);
    watch.view?.requestMeasure();
  };
  const attach = (watch: Watch, view: EditorView | null): void => {
    if (watch.view !== view) {
      if (watch.view) {
        const group = byView.get(watch.view);
        group?.delete(watch);
        if (!group?.size) byView.delete(watch.view);
      }
      watch.view = view;
      if (view) {
        const group = byView.get(view) ?? new Set<Watch>();
        group.add(watch);
        byView.set(view, group);
      }
    }
    if (view) pending.delete(watch);
    notify(watch);
  };
  const sync = (view: EditorView): void => {
    if (stopped || scheduled.has(view)) return;
    scheduled.add(view);
    queueMicrotask(() => {
      scheduled.delete(view);
      if (stopped) return;
      // New widgets can be inserted after their component loads.
      for (const watch of pending) if (view.dom.contains(watch.element)) attach(watch, view);
      for (const watch of byView.get(view) ?? []) notify(watch);
    });
  };

  plugin.registerEditorExtension(ViewPlugin.fromClass(class {
    private live: boolean | undefined;
    constructor(private readonly view: EditorView) {
      this.live = view.state.field(editorLivePreviewField, false);
      sync(view);
    }
    update(update: ViewUpdate): void {
      const live = update.state.field(editorLivePreviewField, false);
      if (update.docChanged || update.selectionSet || update.viewportChanged || live !== this.live) sync(this.view);
      this.live = live;
    }
    destroy(): void {
      for (const watch of byView.get(this.view) ?? []) {
        watch.view = null; watch.visible = false; pending.add(watch); watch.change(false);
      }
      byView.delete(this.view);
    }
  }));
  plugin.register(() => {
    stopped = true;
    watches.clear(); pending.clear(); byView.clear();
  });
  return (element, change) => {
    const watch: Watch = { element, change, view: null };
    watches.add(watch); pending.add(watch);
    const refresh = (): void => {
      if (!stopped && watches.has(watch)) attach(watch, EditorView.findFromDOM(element) ?? null);
    };
    queueMicrotask(refresh);
    return { refresh, dispose: () => {
      watches.delete(watch); pending.delete(watch);
      if (watch.view) {
        const group = byView.get(watch.view);
        group?.delete(watch);
        if (!group?.size) byView.delete(watch.view);
      }
    } };
  };
}
