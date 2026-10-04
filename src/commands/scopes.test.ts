import { describe, expect, test } from 'bun:test';
import type { Command } from 'commander';
import { buildProgram } from '../index.ts';
import { DEFAULT_SCOPES } from './auth/login.ts';

type Route = readonly [method: string, path: string, scope: string | null];
const commandRoutes: Record<string, readonly Route[]> = {
  'auth login': [],
  'auth logout': [],
  'auth status': [],
  'signups list': [['GET', '/v1/signups', 'signups:read']],
  'signups list --watch': [
    ['GET', '/v1/signups', 'signups:read'],
    ['GET', '/v1/webhooks/events', 'webhooks:read'],
  ],
  'signups create': [['POST', '/v1/signups', 'signups:write']],
  'signups view': [['GET', '/v1/signups/:id', 'signups:read']],
  'signups edit': [
    ['GET', '/v1/signups/:id', 'signups:read'],
    ['PATCH', '/v1/signups/:id', 'signups:write'],
  ],
  'signups cancel': [['DELETE', '/v1/signups/:id', 'signups:write']],
  'signups duplicate': [['POST', '/v1/signups/:id/duplicate', 'signups:write']],
  'signups publish': [['POST', '/v1/signups/:id/publish', 'signups:write']],
  'participants list': [['GET', '/v1/signups/:id/participants', 'participants:read']],
  'participants list --watch': [
    ['GET', '/v1/signups/:id/participants', 'participants:read'],
    ['GET', '/v1/webhooks/events', 'webhooks:read'],
  ],
  'participants add': [['POST', '/v1/signups/:id/participants', null]],
  'participants add --slot': [
    ['GET', '/v1/signups/:id/slots', 'signups:read'],
    ['POST', '/v1/signups/:id/participants', null],
  ],
  'participants add --item': [
    ['GET', '/v1/signups/:id/items', 'signups:read'],
    ['POST', '/v1/signups/:id/participants', null],
  ],
  'participants remove': [
    ['DELETE', '/v1/signups/:id/participants/:participantId', 'participants:write'],
  ],
  register: [['POST', '/v1/signups/:id/participants', null]],
  'register --slot': [
    ['GET', '/v1/signups/:id/slots', 'signups:read'],
    ['POST', '/v1/signups/:id/participants', null],
  ],
  'register --item': [
    ['GET', '/v1/signups/:id/items', 'signups:read'],
    ['POST', '/v1/signups/:id/participants', null],
  ],
  'ai draft': [['POST', '/v1/signups/from-description', 'ai:draft']],
  analytics: [['GET', '/v1/signups/:id/analytics', 'analytics:read']],
  'webhooks list': [['GET', '/v1/webhooks', 'webhooks:read']],
  'webhooks create': [['POST', '/v1/webhooks', 'webhooks:write']],
  'webhooks listen': [['GET', '/v1/webhooks/events', 'webhooks:read']],
  completion: [],
};

function commandNames(parent: Command, prefix = ''): string[] {
  return parent.commands.flatMap((command) => {
    const name = [prefix, command.name()].filter(Boolean).join(' ');
    return command.commands.length ? commandNames(command, name) : [name];
  });
}

describe('shipped command scope coverage', () => {
  test('maps every registered command and its REST/SSE variants', () => {
    const commands = commandNames(buildProgram());
    const variants = commands.flatMap((name) => {
      if (name === 'signups list' || name === 'participants list') return [`${name} --watch`];
      if (name === 'register' || name === 'participants add') {
        return [`${name} --slot`, `${name} --item`];
      }
      return [];
    });
    expect(Object.keys(commandRoutes).sort()).toEqual([...commands, ...variants].sort());
  });

  test('requests exactly the union needed by shipped commands plus offline access', () => {
    const union = new Set(
      Object.values(commandRoutes)
        .flat()
        .map(([, , scope]) => scope)
        .filter((scope): scope is string => scope !== null),
    );
    union.add('offline_access');
    const defaults = DEFAULT_SCOPES.split(' ');
    expect(defaults.length).toBe(new Set(defaults).size);
    expect(defaults.sort()).toEqual([...union].sort());
  });
});
