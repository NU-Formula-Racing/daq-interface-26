import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { parseLine, type ParserEvent } from './protocol.ts';

export interface ParserManagerOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  restartOnExit?: boolean;
  restartDelayMs?: number;
}

/**
 * Spawn and manage a parser subprocess. Emits:
 *   - 'event' (ParserEvent) — one per successfully-parsed stdout line
 *   - 'stderr' (string) — one per line of stderr
 *   - 'exit' (code: number | null, signal: NodeJS.Signals | null)
 *   - 'restart' () — fired just before re-spawning
 */
export class ParserManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopRequested = false;
  private buf = '';
  private stderrBuf = '';

  constructor(private opts: ParserManagerOptions) {
    super();
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.running) return;
    this.stopRequested = false;
    this.spawn();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (!this.child) return;
    const child = this.child;
    return new Promise((resolve) => {
      const done = () => resolve();
      if (child.exitCode !== null) return done();
      child.once('close', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
    });
  }

  private spawn(): void {
    const child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onStderr(chunk));
    child.on('close', (code, signal) => {
      if (this.buf.length > 0) {
        const ev = parseLine(this.buf);
        if (ev) this.emit('event', ev);
        this.buf = '';
      }
      this.child = null;
      this.emit('exit', code, signal);
      if (!this.stopRequested && this.opts.restartOnExit) {
        this.emit('restart');
        setTimeout(
          () => this.spawn(),
          this.opts.restartDelayMs ?? 1_000
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const ev = parseLine(line);
      if (ev) this.emit('event', ev);
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuf += chunk;
    let idx: number;
    while ((idx = this.stderrBuf.indexOf('\n')) !== -1) {
      const line = this.stderrBuf.slice(0, idx);
      this.stderrBuf = this.stderrBuf.slice(idx + 1);
      if (line) this.emit('stderr', line);
    }
  }
}
