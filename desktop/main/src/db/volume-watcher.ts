import { existsSync } from 'fs';
import { join } from 'path';

export interface VolumeWatcherOptions {
  /** Absolute path that should keep existing while the DB is mounted. */
  path: string;
  /** Polling interval in ms. Default 3000. */
  intervalMs?: number;
  /** Called once when the path disappears. */
  onDisconnect: () => void;
}

/**
 * Polls a data-dir path and fires `onDisconnect` once if the volume goes away
 * mid-session. Used so that yanking an external drive while the embedded
 * Postgres is running surfaces as a clean UI state instead of an opaque crash.
 *
 * Disconnect is detected by transitioning from "path + PG_VERSION both exist"
 * to "at least one missing". If the path was never reachable to begin with,
 * we never fire — callers handle that case via the normal boot flow.
 */
export class VolumeWatcher {
  private readonly path: string;
  private readonly intervalMs: number;
  private readonly onDisconnect: () => void;
  private timer: NodeJS.Timeout | null = null;
  private wasReachable = false;
  private fired = false;

  constructor(opts: VolumeWatcherOptions) {
    this.path = opts.path;
    this.intervalMs = opts.intervalMs ?? 3000;
    this.onDisconnect = opts.onDisconnect;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Don't ref the timer — it shouldn't keep the event loop alive on its own.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.fired) return;
    const reachable =
      existsSync(this.path) && existsSync(join(this.path, 'PG_VERSION'));
    if (reachable) {
      this.wasReachable = true;
      return;
    }
    if (this.wasReachable) {
      this.fired = true;
      this.stop();
      try {
        this.onDisconnect();
      } catch {
        /* swallow — caller's problem */
      }
    }
  }
}
