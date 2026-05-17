import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface OpenUrlOptions {
  spawnImpl?: typeof spawn;
  platformImpl?: () => NodeJS.Platform;
}

// The URL handed to openUrl comes from the OAuth server's device-authorization
// response, i.e. it is not fully trusted. Before passing it to a platform
// opener we parse it and require an http(s) scheme. This both blocks non-web
// schemes (`file:`, app handlers) and guarantees we forward the normalized,
// percent-encoded `href` rather than attacker-chosen raw bytes.
export function sanitizeOpenableUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`refusing to open malformed URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refusing to open non-web URL (scheme "${parsed.protocol}")`);
  }
  return parsed.href;
}

export async function openUrl(url: string, opts: OpenUrlOptions = {}): Promise<void> {
  const sp = opts.spawnImpl ?? spawn;
  const plat = (opts.platformImpl ?? platform)();
  const safeUrl = sanitizeOpenableUrl(url);

  let command: string;
  let args: string[];
  if (plat === 'darwin') {
    command = 'open';
    args = [safeUrl];
  } else if (plat === 'win32') {
    // Deliberately NOT `cmd /c start <url>`: cmd.exe re-parses its argument,
    // so a URL containing `&`/`|`/`"` could inject commands. rundll32 receives
    // the URL as a single argv element and never goes through a shell.
    command = 'rundll32';
    args = ['url.dll,FileProtocolHandler', safeUrl];
  } else {
    command = 'xdg-open';
    args = [safeUrl];
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
