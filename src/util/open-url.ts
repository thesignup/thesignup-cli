import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface OpenUrlOptions {
  spawnImpl?: typeof spawn;
  platformImpl?: () => NodeJS.Platform;
}

export async function openUrl(url: string, opts: OpenUrlOptions = {}): Promise<void> {
  const sp = opts.spawnImpl ?? spawn;
  const plat = (opts.platformImpl ?? platform)();

  let command: string;
  let args: string[];
  if (plat === 'darwin') {
    command = 'open';
    args = [url];
  } else if (plat === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  await new Promise<void>((resolve, reject) => {
    const child = sp(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
