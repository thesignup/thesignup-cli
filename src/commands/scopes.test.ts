import { describe, expect, test } from 'bun:test';
import type { Command } from 'commander';
import { buildProgram } from '../index.ts';
import { DEFAULT_SCOPES } from './auth/login.ts';
import { COMMAND_SCOPES, OFFLINE_ACCESS_SCOPE, requiredScopesForCommands } from './scopes.ts';

function leafCommandPaths(cmd: Command, prefix: string[] = []): string[] {
  const out: string[] = [];
  for (const sub of cmd.commands) {
    const path = [...prefix, sub.name()];
    if (sub.commands.length > 0) out.push(...leafCommandPaths(sub, path));
    else out.push(path.join(' '));
  }
  return out;
}

describe('command → required scope map', () => {
  const commands = leafCommandPaths(buildProgram());

  test('every shipped command declares its scopes', () => {
    const missing = commands.filter((c) => !(c in COMMAND_SCOPES));
    expect(missing).toEqual([]);
  });

  test('no entry refers to a command that does not exist', () => {
    const stale = Object.keys(COMMAND_SCOPES).filter((c) => !commands.includes(c));
    expect(stale).toEqual([]);
  });

  test('DEFAULT_SCOPES covers every required scope, and only those (plus offline_access)', () => {
    const granted = DEFAULT_SCOPES.split(' ').sort();
    const expected = [...requiredScopesForCommands(), OFFLINE_ACCESS_SCOPE].sort();
    expect(granted).toEqual(expected);
  });

  test('pins the scopes for the commands that previously 403d', () => {
    expect(COMMAND_SCOPES['analytics']).toEqual(['analytics:read']);
    expect(COMMAND_SCOPES['ai draft']).toEqual(['ai:draft']);
    expect(DEFAULT_SCOPES.split(' ')).toContain('analytics:read');
    expect(DEFAULT_SCOPES.split(' ')).toContain('ai:draft');
  });

  test('does not request register:write — the participants POST route requires no scope', () => {
    expect(DEFAULT_SCOPES.split(' ')).not.toContain('register:write');
  });
});
