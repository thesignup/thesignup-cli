#!/usr/bin/env bun
import { Command } from 'commander';
import { runLogin } from './commands/auth/login.ts';
import { runLogout } from './commands/auth/logout.ts';
import { runStatus } from './commands/auth/status.ts';

const VERSION = '0.0.1';

interface GlobalFlags {
  profile?: string;
  apiBase?: string;
  json?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('thesignup')
    .description('thesignup command-line tool')
    .version(VERSION)
    .option('--profile <name>', 'profile to use (default: env THESIGNUP_PROFILE or "default")')
    .option('--api-base <url>', 'API base URL (default: https://thesignup.app)')
    .option('--json', 'emit machine-readable JSON output');

  const auth = program.command('auth').description('authenticate with thesignup');

  auth
    .command('login')
    .description('start the device-code OAuth flow and store credentials')
    .option('--no-browser', 'do not auto-open the verification URL in a browser')
    .option('--scope <scope>', 'space-separated scope string (overrides default)')
    .action(async (cmdOpts: { browser?: boolean; scope?: string }) => {
      const g = pickGlobals(program);
      const code = await runLogin({
        profile: g.profile,
        apiBase: g.apiBase,
        json: g.json,
        noBrowser: cmdOpts.browser === false,
        scope: cmdOpts.scope,
      });
      process.exit(code);
    });

  auth
    .command('logout')
    .description('revoke and clear stored credentials for the active profile')
    .action(async () => {
      const g = pickGlobals(program);
      const code = await runLogout({
        profile: g.profile,
        apiBase: g.apiBase,
        json: g.json,
      });
      process.exit(code);
    });

  auth
    .command('status')
    .description('print the active profile, identity, and scopes')
    .action(async () => {
      const g = pickGlobals(program);
      const code = await runStatus({
        profile: g.profile,
        apiBase: g.apiBase,
        json: g.json,
      });
      process.exit(code);
    });

  return program;
}

function pickGlobals(program: Command): GlobalFlags {
  const opts = program.opts<{ profile?: string; apiBase?: string; json?: boolean }>();
  const out: GlobalFlags = {};
  if (opts.profile) out.profile = opts.profile;
  if (opts.apiBase) out.apiBase = opts.apiBase;
  if (opts.json) out.json = true;
  return out;
}

if (import.meta.main) {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}
