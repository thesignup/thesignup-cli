import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompletion, __internals } from './completion.ts';

describe('completion internals', () => {
  test('detectShellFromEnv reads $SHELL', () => {
    expect(__internals.detectShellFromEnv({ SHELL: '/bin/zsh' } as NodeJS.ProcessEnv)).toBe('zsh');
    expect(__internals.detectShellFromEnv({ SHELL: '/usr/bin/fish' } as NodeJS.ProcessEnv)).toBe(
      'fish',
    );
    expect(__internals.detectShellFromEnv({ SHELL: '/bin/bash' } as NodeJS.ProcessEnv)).toBe(
      'bash',
    );
    expect(__internals.detectShellFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      __internals.detectShellFromEnv({ SHELL: '/bin/elvish' } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  test('completionScript references thesignup and top-level commands', () => {
    const bash = __internals.completionScript('bash');
    expect(bash).toContain('_thesignup');
    expect(bash).toContain('signups');
    expect(bash).toContain('webhooks');

    const zsh = __internals.completionScript('zsh');
    expect(zsh).toContain('#compdef thesignup');
    expect(zsh).toContain('participants');

    const fish = __internals.completionScript('fish');
    expect(fish).toContain('complete -c thesignup');
    expect(fish).toContain('signups');
  });

  test('installPath uses XDG-ish defaults', () => {
    expect(__internals.installPath('bash', '/home/u')).toBe(
      '/home/u/.local/share/bash-completion/completions/thesignup',
    );
    expect(__internals.installPath('zsh', '/home/u')).toBe('/home/u/.zsh/completions/_thesignup');
    expect(__internals.installPath('fish', '/home/u')).toBe(
      '/home/u/.config/fish/completions/thesignup.fish',
    );
  });
});

describe('runCompletion', () => {
  test('explicit shell prints script to stdout (exit 0)', async () => {
    const code = await runCompletion(
      { shell: 'bash' },
      { env: {} as NodeJS.ProcessEnv, homeDir: () => '/tmp' },
    );
    expect(code).toBe(0);
  });

  test('unsupported shell name → exit 1', async () => {
    const code = await runCompletion({ shell: 'powershell' }, { env: {} as NodeJS.ProcessEnv });
    expect(code).toBe(1);
  });

  test('--install writes to the expected path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'thesignup-completion-test-'));
    try {
      const code = await runCompletion(
        { shell: 'fish', install: true, json: true },
        { env: {} as NodeJS.ProcessEnv, homeDir: () => home },
      );
      expect(code).toBe(0);
      const target = join(home, '.config', 'fish', 'completions', 'thesignup.fish');
      const written = readFileSync(target, 'utf8');
      expect(written).toContain('complete -c thesignup');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('no shell + no $SHELL → exit 1 with helpful message', async () => {
    const code = await runCompletion({}, { env: {} as NodeJS.ProcessEnv });
    expect(code).toBe(1);
  });
});
