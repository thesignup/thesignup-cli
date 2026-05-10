import { describe, expect, test } from 'bun:test';
import { DEFAULT_API_BASE, DEFAULT_PROFILE, resolveProfile } from './profile.ts';

describe('resolveProfile', () => {
  test('defaults when nothing is provided', () => {
    const ctx = resolveProfile({ env: {} });
    expect(ctx.name).toBe(DEFAULT_PROFILE);
    expect(ctx.apiBase).toBe(DEFAULT_API_BASE);
  });

  test('prefers --profile flag over env', () => {
    const ctx = resolveProfile({ flagProfile: 'work', env: { THESIGNUP_PROFILE: 'env' } });
    expect(ctx.name).toBe('work');
  });

  test('falls back to env when no flag', () => {
    const ctx = resolveProfile({ env: { THESIGNUP_PROFILE: 'env' } });
    expect(ctx.name).toBe('env');
  });

  test('prefers --api-base flag over env', () => {
    const ctx = resolveProfile({
      flagApiBase: 'https://flag.example',
      env: { THESIGNUP_API_BASE: 'https://env.example' },
    });
    expect(ctx.apiBase).toBe('https://flag.example');
  });

  test('rejects invalid profile names', () => {
    expect(() => resolveProfile({ flagProfile: 'has space' })).toThrow();
    expect(() => resolveProfile({ flagProfile: '' })).toThrow();
    expect(() => resolveProfile({ flagProfile: 'a'.repeat(65) })).toThrow();
  });

  test('accepts dashes, underscores, digits', () => {
    expect(resolveProfile({ flagProfile: 'work-1', env: {} }).name).toBe('work-1');
    expect(resolveProfile({ flagProfile: 'CI_2', env: {} }).name).toBe('CI_2');
  });
});
