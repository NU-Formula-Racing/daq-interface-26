import chokidar, { type FSWatcher } from 'chokidar';
import type pg from 'pg';
import { ImportQueue } from './queue.ts';

export interface FolderWatcherOptions {
  dir: string;
  pool: pg.Pool;
  importer: (file: string) => Promise<void>;
}

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private queue: ImportQueue;
  private seen = new Set<string>();

  constructor(private opts: FolderWatcherOptions) {
    this.queue = new ImportQueue(async (file) => {
      await this.opts.importer(file);
      this.seen.add(file);
    });
  }

  async start(): Promise<void> {
    // Seed `seen` with already-imported files so we don't re-import on boot.
    const { rows } = await this.opts.pool.query<{ source_file: string }>(
      `SELECT source_file FROM sessions WHERE source = 'sd_import' AND source_file IS NOT NULL`
    );
    for (const r of rows) this.seen.add(r.source_file);

    this.watcher = chokidar.watch(this.opts.dir, {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignored: (path: string) =>
        !/\.(nfr|NFR)$/.test(path) && path !== this.opts.dir,
    });

    this.watcher.on('add', (path: string) => {
      if (this.seen.has(path)) return;
      this.seen.add(path);
      this.queue.enqueue(path);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    await this.queue.drain();
  }
}
