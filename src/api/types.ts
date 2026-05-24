export type SignupStatus = 'draft' | 'active' | 'archived' | 'canceled';

export interface SignupSlot {
  id?: string;
  title: string;
  capacity?: number;
  filled?: number;
  description?: string;
}

export interface Signup {
  id: string;
  slug: string;
  status: SignupStatus;
  title: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  slots?: SignupSlot[];
  url?: string;
  created_at: string;
  updated_at: string;
}

export interface Participant {
  id: string;
  signup_id: string;
  name: string;
  email?: string;
  slot?: number | string;
  items?: string;
  created_at: string;
}

export interface SignupAnalytics {
  signup_id: string;
  total_participants: number;
  capacity?: number;
  fill_rate?: number;
  slots?: { id?: string; title: string; filled: number; capacity?: number }[];
  views?: number;
}

export interface ListSignupsResponse {
  signups: Signup[];
}

export interface ListParticipantsResponse {
  participants: Participant[];
}

export interface AiDraftResponse {
  draft: Partial<Signup>;
}

// camelCase to match server DTOs. See thesignup/src/app/api/v1/signups/[id]/_subresources.ts.
export interface TimeSlotDto {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string;
  maxParticipants: number;
  title: string | null;
  description: string | null;
  location: string | null;
}

export interface ItemDto {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  maxContributors: number;
}

export interface ListSlotsResponse {
  data: TimeSlotDto[];
}

export interface ListItemsResponse {
  data: ItemDto[];
}

export type WebhookStatus = 'active' | 'paused' | 'failing';

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: WebhookStatus;
  secret?: string;
  created_at: string;
  updated_at?: string;
  description?: string;
}

export interface ListWebhooksResponse {
  webhooks: Webhook[];
}

// Envelope emitted by GET /v1/webhooks/events (the SSE listen stream).
// Matches the server's WebhookEnvelope from thesignup/src/server/webhooks/types.ts.
// Note: SSE-streamed events do NOT carry a signature — signing is
// applied per-endpoint at HTTP delivery time. Receivers that need to
// verify signatures should register a real webhook endpoint (POST
// /v1/webhooks) instead of consuming the live stream.
export interface WebhookEvent {
  id: string;
  type: string;
  created: number;
  organizationId: string;
  data: Record<string, unknown>;
}
