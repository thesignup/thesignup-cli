export const DEFAULT_PROFILE = 'default';
export const DEFAULT_API_BASE = 'https://thesignup.app';

export interface ProfileContext {
  name: string;
  apiBase: string;
}

export interface ResolveProfileInput {
  flagProfile?: string | undefined;
  flagApiBase?: string | undefined;
  env?: NodeJS.ProcessEnv;
}

export function resolveProfile(input: ResolveProfileInput = {}): ProfileContext {
  const env = input.env ?? process.env;
  const name = input.flagProfile ?? env.THESIGNUP_PROFILE ?? DEFAULT_PROFILE;
  const apiBase = input.flagApiBase ?? env.THESIGNUP_API_BASE ?? DEFAULT_API_BASE;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error(
      `invalid profile name: "${name}" (must be 1–64 chars of letters, digits, "_" or "-")`,
    );
  }
  return { name, apiBase };
}
