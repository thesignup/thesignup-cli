// Generated from api/openapi.json by scripts/generate-api-types.cjs. Do not edit.

export type SignupSummary = {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'closed';
  eventDate: string;
  signupCloseDate: string | null;
  location: string | null;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SignupDetail = SignupSummary & {
  description: string | null;
  maxParticipants: number | null;
  commitmentRequired: boolean;
  requiresPhone: boolean;
  timezone: string;
  eventWideCustomField: {
    name: string;
    required: boolean;
    type: 'short' | 'long';
  } | null;
  days: Day[];
};

export type Participant = {
  id: string;
  eventId: string;
  name: string;
  email: string;
  phone: string | null;
  quantityCommitted: number;
  timeSlotId: string | null;
  itemId: string | null;
  slotCustomFieldResponse: string | null;
  itemCustomFieldResponse: string | null;
  eventCustomFieldResponse: string | null;
  createdAt: string;
  slot: {
    id: string;
    title: string | null;
    startTime: string;
    endTime: string;
  } | null;
  item: {
    id: string;
    name: string;
    timeSlotId: string | null;
    eventDayId: string | null;
  } | null;
};

export type AnalyticsResponse = {
  eventId: string;
  participantCount: number;
  quantityCommitted: number;
  fillRate: {
    capacity: number | null;
    ratio: number | null;
  };
  slots: SlotAnalytics[];
  items: ItemAnalytics[];
  gaps: AnalyticsGap[];
  responseTime: {
    firstRegistrationAt: string | null;
    lastRegistrationAt: string | null;
    averageHoursBetweenRegistrations: number | null;
  };
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string | null;
  eventTypes: (
    | 'signup.created'
    | 'signup.updated'
    | 'signup.published'
    | 'signup.canceled'
    | 'participant.registered'
    | 'participant.canceled'
    | 'slot.filled'
    | 'slot.opened'
    | 'item.claimed'
    | 'item.released'
    | 'reminder.sent'
  )[];
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrRotateWebhookResponse = {
  endpoint: WebhookEndpoint;
  signingSecret: string;
};

export type MeResponse = {
  organization: OrganizationSummary;
  user: UserSummary | null;
  scopes: string[];
};

export type Item = {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  maxPerPerson: number;
  customField: {
    name: string;
    required: boolean;
    type: 'short' | 'long';
  } | null;
  askDetails: {
    enabled: boolean;
    label: string;
    placeholder: string;
    required?: boolean;
  } | null;
  category: string | null;
  sortOrder: number | null;
  scope: ItemScope;
  createdAt: string;
};

export type TimeSlot = {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string;
  maxParticipants: number;
  maxPerPerson: number;
  title: string | null;
  description: string | null;
  location: string | null;
  customField: {
    name: string;
    placeholder?: string;
    required: boolean;
    type: 'short' | 'long';
  } | null;
  question: Question | null;
  questionSource: 'own' | 'series' | null;
  createdAt: string;
};

export type ListSignupsResponse = {
  data: SignupSummary[];
  nextCursor: string | null;
};

export type ListParticipantsResponse = {
  data: Participant[];
};

export type ListWebhooksResponse = {
  data: WebhookEndpoint[];
};

export type ListItemsResponse = {
  data: Item[];
};

export type ListTimeSlotsResponse = {
  data: TimeSlot[];
};

export type FromDescriptionResponse = {
  draft: SignupDraft;
};

export type Day = {
  id: string;
  eventId: string;
  date: string;
  seriesId: string | null;
  cancelledAt: string | null;
  noLiveTime: boolean;
  question: Question | null;
  questionSource: 'own' | 'series' | null;
  isPast: boolean;
};

export type SlotAnalytics = {
  id: string;
  title: string | null;
  capacity: number;
  registered: number;
  ratio: number | null;
};

export type ItemAnalytics = {
  id: string;
  name: string;
  needed: number;
  claimed: number;
  ratio: number | null;
};

export type AnalyticsGap = {
  kind: 'slot' | 'item';
  id: string;
  label: string | null;
  shortBy: number;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
};

export type UserSummary = {
  id: string;
  name: string;
  email: string;
};

export type ItemScope =
  | {
      kind: 'day';
      dayId: string;
    }
  | {
      kind: 'slot';
      slotId: string;
    };

export type Question = {
  label: string;
  placeholder?: string;
  required: boolean;
};

export type SignupDraft = {
  title: string;
  description: string;
  category:
    | 'potluck'
    | 'snack-rotation'
    | 'volunteer-shift'
    | 'carpool'
    | 'classroom-party'
    | 'other';
  location: string | null;
  suggestedDate: string | null;
  endDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone: string | null;
  timeSlots: {
    label: string;
    description?: string;
    startTime: string;
    endTime: string;
    capacity: number;
  }[];
  itemList: {
    name: string;
    quantityNeeded: number;
    notes?: string;
  }[];
  reminderCadence: 'none' | 'day-before' | 'week-and-day-before';
  estimatedParticipants: number | null;
};

export type SignupStatus = SignupSummary['status'];

export type Signup = SignupDetail;

export type SignupAnalytics = AnalyticsResponse;

export type Webhook = WebhookEndpoint;

export type TimeSlotDto = TimeSlot;

export type ItemDto = Item;

export type ListSlotsResponse = ListTimeSlotsResponse;

export type AiDraftResponse = FromDescriptionResponse;

export type WebhookEventType =
  | 'signup.created'
  | 'signup.updated'
  | 'signup.published'
  | 'signup.canceled'
  | 'participant.registered'
  | 'participant.canceled'
  | 'slot.filled'
  | 'slot.opened'
  | 'item.claimed'
  | 'item.released'
  | 'reminder.sent';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created: number;
  organizationId: string;
  data: Record<string, unknown>;
}
