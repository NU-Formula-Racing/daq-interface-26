/**
 * When executed (via `tsx` or `node --loader tsx`), this script prints a
 * scripted sequence of JSON-line events and exits. Used by parser-manager
 * tests to simulate real parser output without needing Python/Postgres.
 *
 * Usage: `tsx fake-parser.ts <name-of-scenario>`
 */
const scenario = process.argv[2];

function emit(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (scenario === 'single-session') {
    emit({ type: 'serial_status', state: 'connected', port: '/dev/ttyFAKE' });
    emit({ type: 'session_started', session_id: 'abc-123', source: 'live' });
    emit({
      type: 'frames',
      rows: [
        { ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 12.3 },
        { ts: '2026-04-22T12:00:01Z', signal_id: 1, value: 12.4 },
      ],
    });
    await sleep(10);
    emit({ type: 'session_ended', session_id: 'abc-123', row_count: 2 });
    emit({ type: 'serial_status', state: 'disconnected' });
    return;
  }

  if (scenario === 'error-then-exit') {
    emit({ type: 'error', msg: 'boom' });
    process.exit(1);
  }

  if (scenario === 'garbled-lines') {
    process.stdout.write('this is not json\n');
    emit({ type: 'serial_status', state: 'connected', port: '/dev/ttyX' });
    process.stdout.write('{"type":"partial\n');
    emit({ type: 'error', msg: 'recovered' });
    return;
  }

  if (scenario === 'hang') {
    await new Promise(() => {});
  }
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(2);
});
