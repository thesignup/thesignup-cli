import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { emit, emitError, makeOutput } from '../util/output.ts';

export type Shell = 'bash' | 'zsh' | 'fish';
export const SUPPORTED_SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish'] as const;

export interface CompletionOptions {
  shell?: string;
  install?: boolean;
  json?: boolean;
}

export interface CompletionDeps {
  env?: NodeJS.ProcessEnv;
  homeDir?: () => string;
  writeFileImpl?: typeof writeFile;
  mkdirImpl?: typeof mkdir;
}

export async function runCompletion(
  opts: CompletionOptions = {},
  deps: CompletionDeps = {},
): Promise<number> {
  const ctx = makeOutput({ json: opts.json });
  try {
    const env = deps.env ?? process.env;
    const home = deps.homeDir?.() ?? homedir();
    const shell = resolveShell(opts.shell, env);
    if (!shell) {
      const detected = detectShellFromEnv(env);
      emit(ctx, { ok: false, supported: SUPPORTED_SHELLS, detected }, [
        `Specify a shell: thesignup completion <bash|zsh|fish> [--install]`,
        detected
          ? `Looks like you're using ${detected}. Try: thesignup completion ${detected}`
          : 'Could not auto-detect $SHELL.',
      ]);
      return 1;
    }

    const script = completionScript(shell);

    if (!opts.install) {
      // Print plain script — must be the only output on stdout so it can be piped to a file.
      if (ctx.format === 'json') {
        emit(ctx, { ok: true, shell, script }, []);
      } else {
        ctx.stdout.write(script);
      }
      return 0;
    }

    const targetPath = installPath(shell, home);
    const write = deps.writeFileImpl ?? writeFile;
    const md = deps.mkdirImpl ?? mkdir;
    await md(dirname(targetPath), { recursive: true });
    await write(targetPath, script, { mode: 0o644 });
    emit(ctx, { ok: true, shell, installed_to: targetPath }, [
      `Installed ${shell} completion to ${targetPath}.`,
      ...postInstallHint(shell),
    ]);
    return 0;
  } catch (err) {
    emitError(ctx, err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function resolveShell(arg: string | undefined, env: NodeJS.ProcessEnv): Shell | null {
  const raw = (arg ?? '').trim().toLowerCase();
  if (raw === 'bash' || raw === 'zsh' || raw === 'fish') return raw;
  if (raw) return null;
  return detectShellFromEnv(env);
}

function detectShellFromEnv(env: NodeJS.ProcessEnv): Shell | null {
  const shellPath = env.SHELL;
  if (!shellPath) return null;
  const base = shellPath.split('/').pop() ?? '';
  if (base === 'bash') return 'bash';
  if (base === 'zsh') return 'zsh';
  if (base === 'fish') return 'fish';
  return null;
}

function installPath(shell: Shell, home: string): string {
  if (shell === 'bash') {
    return join(home, '.local', 'share', 'bash-completion', 'completions', 'thesignup');
  }
  if (shell === 'zsh') {
    return join(home, '.zsh', 'completions', '_thesignup');
  }
  return join(home, '.config', 'fish', 'completions', 'thesignup.fish');
}

function postInstallHint(shell: Shell): string[] {
  if (shell === 'bash') {
    return [
      'Restart your shell or `source` the completion file to activate.',
      'Most distros pick this up automatically via bash-completion.',
    ];
  }
  if (shell === 'zsh') {
    return [
      'Add this to ~/.zshrc if not already present:',
      '  fpath=(~/.zsh/completions $fpath)',
      '  autoload -Uz compinit && compinit',
    ];
  }
  return ['Fish picks up new completions automatically on next prompt.'];
}

const TOP_LEVEL_COMMANDS = [
  'auth',
  'signups',
  'participants',
  'register',
  'ai',
  'analytics',
  'webhooks',
  'completion',
  'help',
];

const AUTH_SUBS = ['login', 'logout', 'status'];
const SIGNUPS_SUBS = ['list', 'create', 'view', 'edit', 'cancel', 'duplicate', 'publish'];
const PARTICIPANTS_SUBS = ['list', 'add', 'remove'];
const WEBHOOKS_SUBS = ['list', 'create', 'listen'];
const AI_SUBS = ['draft'];

function completionScript(shell: Shell): string {
  if (shell === 'bash') return bashScript();
  if (shell === 'zsh') return zshScript();
  return fishScript();
}

function bashScript(): string {
  return `# thesignup bash completion
_thesignup() {
  local cur prev words cword
  _init_completion || return
  local top="${TOP_LEVEL_COMMANDS.join(' ')}"
  case "\${words[1]}" in
    auth)         COMPREPLY=( $(compgen -W "${AUTH_SUBS.join(' ')}" -- "$cur") ); return ;;
    signups)      COMPREPLY=( $(compgen -W "${SIGNUPS_SUBS.join(' ')}" -- "$cur") ); return ;;
    participants) COMPREPLY=( $(compgen -W "${PARTICIPANTS_SUBS.join(' ')}" -- "$cur") ); return ;;
    webhooks)     COMPREPLY=( $(compgen -W "${WEBHOOKS_SUBS.join(' ')}" -- "$cur") ); return ;;
    ai)           COMPREPLY=( $(compgen -W "${AI_SUBS.join(' ')}" -- "$cur") ); return ;;
    completion)   COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") ); return ;;
  esac
  COMPREPLY=( $(compgen -W "$top" -- "$cur") )
}
complete -F _thesignup thesignup
`;
}

function zshScript(): string {
  return `#compdef thesignup
_thesignup() {
  local -a top
  top=(${TOP_LEVEL_COMMANDS.map((c) => `'${c}'`).join(' ')})
  if (( CURRENT == 2 )); then
    _describe 'command' top
    return
  fi
  case "\${words[2]}" in
    auth)         _values 'auth subcommand' ${AUTH_SUBS.map((s) => `'${s}'`).join(' ')} ;;
    signups)      _values 'signups subcommand' ${SIGNUPS_SUBS.map((s) => `'${s}'`).join(' ')} ;;
    participants) _values 'participants subcommand' ${PARTICIPANTS_SUBS.map((s) => `'${s}'`).join(' ')} ;;
    webhooks)     _values 'webhooks subcommand' ${WEBHOOKS_SUBS.map((s) => `'${s}'`).join(' ')} ;;
    ai)           _values 'ai subcommand' ${AI_SUBS.map((s) => `'${s}'`).join(' ')} ;;
    completion)   _values 'shell' 'bash' 'zsh' 'fish' ;;
  esac
}
_thesignup "$@"
`;
}

function fishScript(): string {
  const lines = [
    '# thesignup fish completion',
    `complete -c thesignup -n '__fish_use_subcommand' -a '${TOP_LEVEL_COMMANDS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from auth' -a '${AUTH_SUBS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from signups' -a '${SIGNUPS_SUBS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from participants' -a '${PARTICIPANTS_SUBS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from webhooks' -a '${WEBHOOKS_SUBS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from ai' -a '${AI_SUBS.join(' ')}'`,
    `complete -c thesignup -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'`,
  ];
  return lines.join('\n') + '\n';
}

export const __internals = {
  resolveShell,
  detectShellFromEnv,
  installPath,
  completionScript,
};
