import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface SerialPort {
  path: string;
  /** Lightweight hint for the picker — e.g. "usbserial-XYZ" extracted from the device name. */
  label: string;
}

/**
 * Enumerate likely USB-serial devices.
 *
 * On macOS and Linux, USB-serial converters and USB CDC ACM devices appear
 * as character devices in /dev. macOS exposes pairs like cu.usbserial-XYZ
 * and tty.usbserial-XYZ; cu.* is the non-blocking one used for outbound
 * connections, which is what pyserial wants.
 *
 * On Windows, ports are COM<N>. We shell out to PowerShell which is always
 * present.
 */
export async function listSerialPorts(): Promise<SerialPort[]> {
  if (process.platform === 'win32') {
    try {
      // Get-CimInstance Win32_SerialPort surfaces only legacy ports; the
      // Win32_PnPEntity query catches USB-CDC adapters too.
      const { stdout } = await execFileP('powershell.exe', [
        '-NoProfile', '-Command',
        "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name }",
      ]);
      const ports: SerialPort[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/\(COM(\d+)\)/);
        if (!m) continue;
        ports.push({ path: `COM${m[1]}`, label: line.trim() });
      }
      return ports;
    } catch {
      return [];
    }
  }

  // macOS + Linux: scan /dev for USB-serial-shaped names.
  const PATTERN = /^(cu|tty)\.(usbserial|usbmodem|SLAB_USBtoUART|wchusbserial|UART)/i;
  const LINUX_PATTERN = /^(ttyUSB|ttyACM)\d+$/;
  try {
    const entries = await readdir('/dev');
    const ports: SerialPort[] = [];
    for (const name of entries) {
      let label: string | null = null;
      if (PATTERN.test(name)) {
        // Prefer the cu.* alias for outbound serial.
        if (name.startsWith('tty.')) continue;
        label = name.replace(/^cu\./, '');
      } else if (LINUX_PATTERN.test(name)) {
        label = name;
      }
      if (label) ports.push({ path: `/dev/${name}`, label });
    }
    // Stable order so picker doesn't flicker.
    ports.sort((a, b) => a.path.localeCompare(b.path));
    return ports;
  } catch {
    return [];
  }
}

export function registerSerialPortRoutes(app: FastifyInstance) {
  app.get('/api/serial/ports', async () => {
    const ports = await listSerialPorts();
    return { ports };
  });
}
