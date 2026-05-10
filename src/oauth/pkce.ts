import { randomBytes, createHash } from 'node:crypto';

export function generateCodeVerifier(byteLength = 32): string {
  return base64UrlEncode(randomBytes(byteLength));
}

export function codeChallengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
