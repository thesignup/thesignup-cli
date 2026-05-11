import type { Signup, Participant, SignupAnalytics } from '../../api/types.ts';

export function formatSignupRow(s: Signup): string {
  const parts = [s.id.padEnd(14), s.status.padEnd(9), truncate(s.title, 38).padEnd(38), s.slug];
  return parts.join('  ');
}

export function signupHeader(): string {
  return ['ID'.padEnd(14), 'STATUS'.padEnd(9), 'TITLE'.padEnd(38), 'SLUG'].join('  ');
}

export function formatSignupDetail(s: Signup): string[] {
  const lines = [`${s.title}  [${s.status}]`, `  id:       ${s.id}`, `  slug:     ${s.slug}`];
  if (s.starts_at) lines.push(`  starts:   ${s.starts_at}`);
  if (s.ends_at) lines.push(`  ends:     ${s.ends_at}`);
  if (s.location) lines.push(`  location: ${s.location}`);
  if (s.url) lines.push(`  url:      ${s.url}`);
  if (s.description) lines.push(`  ${s.description}`);
  if (s.slots && s.slots.length > 0) {
    lines.push('  slots:');
    for (const slot of s.slots) {
      const cap = slot.capacity !== undefined ? `${slot.filled ?? 0}/${slot.capacity}` : '';
      lines.push(`    - ${slot.title}${cap ? ` (${cap})` : ''}`);
    }
  }
  return lines;
}

export function formatParticipantRow(p: Participant): string {
  const slot = p.slot !== undefined ? String(p.slot) : '-';
  const items = p.items ?? '';
  return [
    p.id.padEnd(14),
    truncate(p.name, 24).padEnd(24),
    slot.padEnd(6),
    truncate(items, 32),
  ].join('  ');
}

export function participantHeader(): string {
  return ['ID'.padEnd(14), 'NAME'.padEnd(24), 'SLOT'.padEnd(6), 'ITEMS'].join('  ');
}

export function formatAnalytics(a: SignupAnalytics): string[] {
  const lines = [`Analytics for ${a.signup_id}:`];
  lines.push(`  participants: ${a.total_participants}`);
  if (a.capacity !== undefined) lines.push(`  capacity:     ${a.capacity}`);
  if (a.fill_rate !== undefined) lines.push(`  fill rate:    ${(a.fill_rate * 100).toFixed(1)}%`);
  if (a.views !== undefined) lines.push(`  views:        ${a.views}`);
  if (a.slots && a.slots.length > 0) {
    lines.push('  by slot:');
    for (const slot of a.slots) {
      const cap = slot.capacity !== undefined ? `/${slot.capacity}` : '';
      lines.push(`    - ${slot.title}: ${slot.filled}${cap}`);
    }
  }
  return lines;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
