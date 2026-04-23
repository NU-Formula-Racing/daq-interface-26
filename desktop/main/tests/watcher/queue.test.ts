import { describe, it, expect } from 'vitest';
import { ImportQueue } from '../../src/watcher/queue.ts';

describe('ImportQueue', () => {
  it('runs jobs serially', async () => {
    const running: string[] = [];
    const q = new ImportQueue(async (file) => {
      running.push(`start:${file}`);
      await new Promise((r) => setTimeout(r, 20));
      running.push(`end:${file}`);
    });

    q.enqueue('a.nfr');
    q.enqueue('b.nfr');
    await q.drain();

    expect(running).toEqual(['start:a.nfr', 'end:a.nfr', 'start:b.nfr', 'end:b.nfr']);
  });

  it('continues after a job throws', async () => {
    const processed: string[] = [];
    const q = new ImportQueue(async (file) => {
      if (file === 'bad') throw new Error('nope');
      processed.push(file);
    });
    q.enqueue('good1');
    q.enqueue('bad');
    q.enqueue('good2');
    await q.drain();
    expect(processed).toEqual(['good1', 'good2']);
  });
});
