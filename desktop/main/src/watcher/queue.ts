type Job = (file: string) => Promise<void>;

export class ImportQueue {
  private pending: string[] = [];
  private draining: Promise<void> = Promise.resolve();
  private idle = true;

  constructor(private run: Job) {}

  enqueue(file: string): void {
    this.pending.push(file);
    if (this.idle) this.startDrain();
  }

  drain(): Promise<void> {
    return this.draining;
  }

  private startDrain(): void {
    this.idle = false;
    this.draining = (async () => {
      while (this.pending.length > 0) {
        const file = this.pending.shift()!;
        try {
          await this.run(file);
        } catch {
          /* surfaced via stderr / parser event emit path */
        }
      }
      this.idle = true;
    })();
  }
}
