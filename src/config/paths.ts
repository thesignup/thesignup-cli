import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'thesignup';

export function configDir(): string {
  if (platform() === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, APP_DIR);
    return join(homedir(), 'AppData', 'Roaming', APP_DIR);
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP_DIR);
  return join(homedir(), '.config', APP_DIR);
}

export function credentialsFile(): string {
  return join(configDir(), 'credentials');
}

export function profilesFile(): string {
  return join(configDir(), 'profiles.json');
}

export function updateCacheFile(): string {
  return join(configDir(), 'update-cache.json');
}
