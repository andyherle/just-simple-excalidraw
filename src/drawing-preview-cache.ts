import type { TFile } from "obsidian";

export type PreviewRenderer = (file: TFile, dark: boolean, signal?: AbortSignal) => Promise<string | null>;

const MAX_ENTRIES = 20;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_EXPORTS = 2;

interface PreviewJob {
  file: TFile;
  dark: boolean;
  version: string;
  controller: AbortController;
  state: "queued" | "running" | "done" | "cancelled";
  users: number;
  bytes: number;
  promise: Promise<string | null>;
  resolve: (svg: string | null) => void;
  reject: (error: unknown) => void;
}

/** Share previews and limit the cache. */
export class DrawingPreviewCache {
  private readonly generations = new WeakMap<TFile, number>();
  private readonly entries = new Map<TFile, Map<boolean, PreviewJob>>();
  private readonly retained = new Set<PreviewJob>();
  private readonly queue: PreviewJob[] = [];
  private activeExports = 0;
  private retainedBytes = 0;
  private scheduled = false;
  disposed = false;

  constructor(private readonly render: PreviewRenderer) {}

  version(file: TFile): string {
    return `${file.path}\0${file.stat?.mtime ?? 0}\0${file.stat?.size ?? 0}\0${this.generations.get(file) ?? 0}`;
  }

  get(file: TFile, dark: boolean, signal: AbortSignal): Promise<string | null> {
    if (this.disposed || signal.aborted) return Promise.resolve(null);
    const version = this.version(file);
    let modes = this.entries.get(file);
    let job = modes?.get(dark);
    if (job && job.version !== version) { this.cancel(job); job = undefined; }
    if (!job) {
      let resolve!: PreviewJob["resolve"], reject!: PreviewJob["reject"];
      const promise = new Promise<string | null>((yes, no) => { resolve = yes; reject = no; });
      job = { file, dark, version, controller: new AbortController(), state: "queued", users: 0, bytes: 0, promise, resolve, reject };
      modes = this.entries.get(file) ?? new Map();
      this.entries.set(file, modes);
      modes.set(dark, job);
      this.queue.push(job);
    }
    if (job.state === "done") {
      this.retained.delete(job);
      this.retained.add(job);
      return job.promise;
    }
    const shared = job;
    shared.users++;
    const result = new Promise<string | null>((resolve, reject) => {
      let waiting = true;
      const release = (): boolean => {
        if (!waiting) return false;
        waiting = false;
        signal.removeEventListener("abort", aborted);
        shared.users--;
        return true;
      };
      const aborted = (): void => {
        if (!release()) return;
        resolve(null);
        if (shared.users === 0 && shared.state !== "done") this.cancel(shared);
      };
      signal.addEventListener("abort", aborted, { once: true });
      shared.promise.then(svg => { if (release()) resolve(svg); }, error => { if (release()) reject(error); });
    });
    this.schedule();
    return result;
  }

  invalidate(file: TFile): void {
    this.generations.set(file, (this.generations.get(file) ?? 0) + 1);
    for (const job of [...this.entries.get(file)?.values() ?? []]) this.cancel(job);
  }

  dispose(): void {
    this.disposed = true;
    for (const modes of [...this.entries.values()]) for (const job of [...modes.values()]) this.cancel(job);
    this.queue.length = 0;
  }

  private forget(job: PreviewJob): void {
    const modes = this.entries.get(job.file);
    if (modes?.get(job.dark) === job) {
      modes.delete(job.dark);
      if (!modes.size) this.entries.delete(job.file);
    }
    if (this.retained.delete(job)) this.retainedBytes -= job.bytes;
  }

  private cancel(job: PreviewJob): void {
    this.forget(job);
    job.controller.abort();
    if (job.state === "queued") {
      const index = this.queue.indexOf(job);
      if (index !== -1) this.queue.splice(index, 1);
    }
    job.state = "cancelled";
    job.resolve(null);
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      while (!this.disposed && this.activeExports < MAX_EXPORTS && this.queue.length) {
        const job = this.queue.shift()!;
        if (job.state !== "queued" || !job.users) continue;
        if (job.version !== this.version(job.file)) { this.cancel(job); continue; }
        job.state = "running";
        this.activeExports++;
        void this.run(job);
      }
    });
  }

  private async run(job: PreviewJob): Promise<void> {
    try {
      const svg = await this.render(job.file, job.dark, job.controller.signal);
      if (job.controller.signal.aborted || this.disposed) return;
      if (job.version !== this.version(job.file)) { this.cancel(job); return; }
      job.state = "done";
      job.bytes = (svg?.length ?? 0) * 2;
      // Do not cache large previews.
      if (job.bytes <= MAX_TEXT_BYTES) {
        this.retained.add(job);
        this.retainedBytes += job.bytes;
        while (this.retained.size > MAX_ENTRIES || this.retainedBytes > MAX_TEXT_BYTES) this.forget(this.retained.values().next().value!);
      } else this.forget(job);
      job.resolve(svg);
    } catch (error) {
      this.forget(job);
      if (job.controller.signal.aborted || this.disposed) job.resolve(null);
      else job.reject(error);
    } finally {
      this.activeExports--;
      this.schedule();
    }
  }
}
