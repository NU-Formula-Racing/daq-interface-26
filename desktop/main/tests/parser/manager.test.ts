import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { ParserManager } from '../../src/parser/manager.ts';
import type { ParserEvent } from '../../src/parser/protocol.ts';

const FAKE_PARSER = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../helpers/fake-parser.ts'
);

function collectEvents(mgr: ParserManager): Promise<ParserEvent[]> {
  return new Promise((resolve) => {
    const events: ParserEvent[] = [];
    mgr.on('event', (e) => events.push(e));
    mgr.on('exit', () => resolve(events));
  });
}

describe('ParserManager', () => {
  it('parses a scripted session from stdout JSON lines', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'single-session'],
      restartOnExit: false,
    });

    const eventsP = collectEvents(mgr);
    mgr.start();
    const events = await eventsP;

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'serial_status',
      'session_started',
      'frames',
      'session_ended',
      'serial_status',
    ]);
    const frames = events.find((e) => e.type === 'frames');
    expect(frames && frames.type === 'frames' && frames.rows).toHaveLength(2);
  }, 30_000);

  it('skips malformed stdout lines without crashing', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'garbled-lines'],
      restartOnExit: false,
    });

    const eventsP = collectEvents(mgr);
    mgr.start();
    const events = await eventsP;

    const types = events.map((e) => e.type);
    expect(types).toEqual(['serial_status', 'error']);
  }, 30_000);

  it('stop() terminates a running process and prevents restart', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'hang'],
      restartOnExit: true,
      restartDelayMs: 50,
    });

    mgr.start();
    await new Promise((r) => setTimeout(r, 500));
    const exited = new Promise<void>((resolve) =>
      mgr.on('exit', () => resolve())
    );
    await mgr.stop();
    await exited;
    expect(mgr.running).toBe(false);
  }, 30_000);
});
