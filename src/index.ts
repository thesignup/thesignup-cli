#!/usr/bin/env bun
import { Command } from 'commander';
import { runLogin } from './commands/auth/login.ts';
import { runLogout } from './commands/auth/logout.ts';
import { runStatus } from './commands/auth/status.ts';
import {
  runSignupsCancel,
  runSignupsCreate,
  runSignupsDuplicate,
  runSignupsEdit,
  runSignupsList,
  runSignupsPublish,
  runSignupsView,
} from './commands/signups/index.ts';
import {
  runParticipantsAdd,
  runParticipantsList,
  runParticipantsRemove,
} from './commands/participants/index.ts';
import { runRegister } from './commands/register.ts';
import { runAiDraft } from './commands/ai.ts';
import { runAnalytics } from './commands/analytics.ts';
import { runWebhooksList, runWebhooksCreate } from './commands/webhooks/index.ts';
import { runWebhooksListen } from './commands/webhooks/listen.ts';
import type { SignupStatus } from './api/types.ts';

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
        ...g,
        noBrowser: cmdOpts.browser === false,
        ...(cmdOpts.scope ? { scope: cmdOpts.scope } : {}),
      });
      process.exit(code);
    });

  auth
    .command('logout')
    .description('revoke and clear stored credentials for the active profile')
    .action(async () => {
      const code = await runLogout(pickGlobals(program));
      process.exit(code);
    });

  auth
    .command('status')
    .description('print the active profile, identity, and scopes')
    .action(async () => {
      const code = await runStatus(pickGlobals(program));
      process.exit(code);
    });

  const signups = program.command('signups').description('manage signups');

  signups
    .command('list')
    .description('list signups')
    .option('--status <status>', 'filter by status (draft, active, archived, canceled)')
    .option('--limit <n>', 'maximum number of signups to return', (v) => Number(v))
    .action(async (cmdOpts: { status?: SignupStatus; limit?: number }) => {
      const g = pickGlobals(program);
      const code = await runSignupsList({
        ...g,
        ...(cmdOpts.status ? { status: cmdOpts.status } : {}),
        ...(cmdOpts.limit !== undefined ? { limit: cmdOpts.limit } : {}),
      });
      process.exit(code);
    });

  signups
    .command('create')
    .description('create a signup from a description or a YAML/JSON file')
    .option('--from-description <text>', 'AI-draft a signup from a description')
    .option('--file <path>', 'path to a YAML or JSON file describing the signup')
    .action(async (cmdOpts: { fromDescription?: string; file?: string }) => {
      const g = pickGlobals(program);
      const code = await runSignupsCreate({
        ...g,
        ...(cmdOpts.fromDescription ? { fromDescription: cmdOpts.fromDescription } : {}),
        ...(cmdOpts.file ? { file: cmdOpts.file } : {}),
      });
      process.exit(code);
    });

  signups
    .command('view <ref>')
    .description('print a signup (by id or slug)')
    .action(async (ref: string) => {
      const code = await runSignupsView({ ...pickGlobals(program), ref });
      process.exit(code);
    });

  signups
    .command('edit <ref>')
    .description('open the signup as YAML in $EDITOR and PATCH the result')
    .option('--editor <cmd>', 'editor command (default: $VISUAL or $EDITOR)')
    .action(async (ref: string, cmdOpts: { editor?: string }) => {
      const g = pickGlobals(program);
      const code = await runSignupsEdit({
        ...g,
        ref,
        ...(cmdOpts.editor ? { editor: cmdOpts.editor } : {}),
      });
      process.exit(code);
    });

  signups
    .command('cancel <ref>')
    .description('cancel a signup')
    .action(async (ref: string) => {
      const code = await runSignupsCancel({ ...pickGlobals(program), ref });
      process.exit(code);
    });

  signups
    .command('duplicate <ref>')
    .description('duplicate a signup as a new draft')
    .action(async (ref: string) => {
      const code = await runSignupsDuplicate({ ...pickGlobals(program), ref });
      process.exit(code);
    });

  signups
    .command('publish <ref>')
    .description('publish a draft signup')
    .action(async (ref: string) => {
      const code = await runSignupsPublish({ ...pickGlobals(program), ref });
      process.exit(code);
    });

  const participants = program
    .command('participants')
    .description('manage participants on a signup');

  participants
    .command('list <signup>')
    .description('list participants for a signup')
    .action(async (signup: string) => {
      const code = await runParticipantsList({ ...pickGlobals(program), signup });
      process.exit(code);
    });

  participants
    .command('add <signup>')
    .description('add a participant to a signup')
    .requiredOption('--name <name>', 'participant name')
    .option('--email <email>', 'participant email')
    .option('--slot <slot>', 'slot identifier or index')
    .option('--items <items>', 'comma-separated items the participant is bringing')
    .action(
      async (
        signup: string,
        cmdOpts: { name: string; email?: string; slot?: string; items?: string },
      ) => {
        const g = pickGlobals(program);
        const code = await runParticipantsAdd({
          ...g,
          signup,
          name: cmdOpts.name,
          ...(cmdOpts.email ? { email: cmdOpts.email } : {}),
          ...(cmdOpts.slot ? { slot: cmdOpts.slot } : {}),
          ...(cmdOpts.items ? { items: cmdOpts.items } : {}),
        });
        process.exit(code);
      },
    );

  participants
    .command('remove <signup> <participantId>')
    .description('remove a participant from a signup')
    .action(async (signup: string, participantId: string) => {
      const code = await runParticipantsRemove({
        ...pickGlobals(program),
        signup,
        participantId,
      });
      process.exit(code);
    });

  program
    .command('register <target>')
    .description('register yourself for a signup (id, slug, or URL)')
    .option('--name <name>', 'registrant name (defaults to logged-in identity if omitted)')
    .option('--email <email>', 'registrant email')
    .option('--slot <slot>', 'slot identifier or index')
    .option('--items <items>', 'comma-separated items')
    .action(
      async (
        target: string,
        cmdOpts: { name?: string; email?: string; slot?: string; items?: string },
      ) => {
        const g = pickGlobals(program);
        const code = await runRegister({
          ...g,
          target,
          ...(cmdOpts.name ? { name: cmdOpts.name } : {}),
          ...(cmdOpts.email ? { email: cmdOpts.email } : {}),
          ...(cmdOpts.slot ? { slot: cmdOpts.slot } : {}),
          ...(cmdOpts.items ? { items: cmdOpts.items } : {}),
        });
        process.exit(code);
      },
    );

  const ai = program.command('ai').description('AI-assisted helpers');

  ai.command('draft <description>')
    .description('produce a YAML signup draft from a free-form description')
    .action(async (description: string) => {
      const code = await runAiDraft({ ...pickGlobals(program), description });
      process.exit(code);
    });

  program
    .command('analytics <signup>')
    .description('print analytics for a signup')
    .action(async (signup: string) => {
      const code = await runAnalytics({ ...pickGlobals(program), signup });
      process.exit(code);
    });

  const webhooks = program.command('webhooks').description('manage webhook endpoints');

  webhooks
    .command('list')
    .description('list configured webhook endpoints')
    .action(async () => {
      const code = await runWebhooksList(pickGlobals(program));
      process.exit(code);
    });

  webhooks
    .command('create')
    .description('register a new webhook endpoint')
    .requiredOption('--url <url>', 'destination URL the events should be POSTed to')
    .requiredOption(
      '--events <patterns>',
      'comma-separated event patterns (e.g. signup.*,participant.created)',
    )
    .option('--description <text>', 'optional description')
    .action(async (cmdOpts: { url: string; events: string; description?: string }) => {
      const g = pickGlobals(program);
      const code = await runWebhooksCreate({
        ...g,
        url: cmdOpts.url,
        events: cmdOpts.events,
        ...(cmdOpts.description ? { description: cmdOpts.description } : {}),
      });
      process.exit(code);
    });

  webhooks
    .command('listen')
    .description('open a long-lived stream and forward webhook events to a local URL')
    .requiredOption(
      '--forward-to <url>',
      'local destination (e.g. localhost:3000/webhooks or http://localhost:3000/webhooks)',
    )
    .option('--events <patterns>', 'comma-separated event patterns to filter on')
    .option('--max-retries <n>', 'maximum reconnect attempts before giving up', (v) => Number(v))
    .action(async (cmdOpts: { forwardTo: string; events?: string; maxRetries?: number }) => {
      const g = pickGlobals(program);
      const controller = new AbortController();
      process.on('SIGINT', () => controller.abort());
      process.on('SIGTERM', () => controller.abort());
      const code = await runWebhooksListen({
        ...g,
        forwardTo: cmdOpts.forwardTo,
        ...(cmdOpts.events ? { events: cmdOpts.events } : {}),
        ...(cmdOpts.maxRetries !== undefined ? { maxRetries: cmdOpts.maxRetries } : {}),
        signal: controller.signal,
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
