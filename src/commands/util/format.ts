import type {
  Signup,
  SignupSummary,
  Participant,
  SignupAnalytics,
  Webhook,
} from '../../api/types.ts';

export function formatSignupRow(s: SignupSummary): string {
  const parts = [s.id.padEnd(14), s.status.padEnd(9), truncate(s.title, 38).padEnd(38), s.slug];
  return parts.join('  ');
}

export function signupHeader(): string {
  return ['ID'.padEnd(14), 'STATUS'.padEnd(9), 'TITLE'.padEnd(38), 'SLUG'].join('  ');
}

export function formatSignupDetail(s: Signup): string[] {
  const lines = [`${s.title}  [${s.status}]`, `  id:       ${s.id}`, `  slug:     ${s.slug}`];
  lines.push(`  event date: ${s.eventDate}`);
  if (s.signupCloseDate) lines.push(`  signups close: ${s.signupCloseDate}`);
  if (s.location) lines.push(`  location: ${s.location}`);
  if (s.description) lines.push(`  ${s.description}`);
  if (s.days.length > 0) lines.push(`  days:     ${s.days.map((day) => day.date).join(', ')}`);
  return lines;
}

export function formatParticipantRow(p: Participant): string {
  const slot = p.slot?.title ?? p.slot?.startTime ?? '-';
  const item = p.item?.name ?? '-';
  return [
    p.id.padEnd(14),
    truncate(p.name, 24).padEnd(24),
    truncate(slot, 24).padEnd(24),
    truncate(item, 32),
  ].join('  ');
}

export function participantHeader(): string {
  return ['ID'.padEnd(14), 'NAME'.padEnd(24), 'SLOT'.padEnd(24), 'ITEM'].join('  ');
}

export function formatAnalytics(a: SignupAnalytics): string[] {
  const lines = [`Analytics for ${a.eventId}:`];
  lines.push(`  participants: ${a.participantCount}`);
  lines.push(`  capacity:     ${a.fillRate.capacity ?? 'uncapped'}`);
  if (a.fillRate.ratio !== null)
    lines.push(`  fill rate:    ${(a.fillRate.ratio * 100).toFixed(1)}%`);
  if (a.slots.length > 0) {
    lines.push('  by slot:');
    for (const slot of a.slots) {
      lines.push(`    - ${slot.title ?? slot.id}: ${slot.registered}/${slot.capacity}`);
    }
  }
  return lines;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function webhookHeader(): string {
  return ['ID'.padEnd(14), 'STATUS'.padEnd(9), 'EVENTS'.padEnd(38), 'URL'].join('  ');
}

export function formatWebhookRow(w: Webhook): string {
  return [
    w.id.padEnd(14),
    (w.paused ? 'paused' : 'active').padEnd(9),
    truncate(w.eventTypes.join(',') || '(all)', 38).padEnd(38),
    w.url,
  ].join('  ');
}

export function formatWebhookDetail(w: Webhook, signingSecret?: string): string[] {
  const lines = [
    `${w.id}  [${w.paused ? 'paused' : 'active'}]`,
    `  url:    ${w.url}`,
    `  events: ${w.eventTypes.join(', ') || '(all)'}`,
  ];
  if (w.description) lines.push(`  desc:   ${w.description}`);
  if (signingSecret)
    lines.push(`  secret: ${signingSecret}  ⚠ store this — it won't be shown again`);
  return lines;
}
