import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ItemDto,
  MeResponse,
  Participant,
  Signup,
  SignupAnalytics,
  TimeSlotDto,
  Webhook,
} from '../src/api/types.ts';

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  example?: unknown;
  allOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}

const spec = JSON.parse(readFileSync(join(import.meta.dir, '../api/openapi.json'), 'utf8')) as {
  components: { schemas: Record<string, Schema> };
};

function sample(schema: Schema): unknown {
  if (schema.$ref) return sample(spec.components.schemas[schema.$ref.split('/').at(-1)!]!);
  if (schema.example !== undefined) return schema.example;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return sample(schema.oneOf[0]!);
  if (schema.allOf) {
    const parts = schema.allOf.filter(
      (part) => !part.type?.includes('null') && (part.$ref || part.type || part.oneOf),
    );
    return Object.assign({}, ...parts.map(sample));
  }
  if (Array.isArray(schema.type)) {
    if (schema.type.includes('null')) return null;
    return sample({ ...schema, type: schema.type[0] });
  }
  if (schema.type === 'object') {
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [key, sample(schema.properties![key]!)]),
    );
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'null') return null;
  if (schema.type === 'string') return '2026-09-15T17:00:00Z';
  throw new Error(`Unsupported API sample: ${JSON.stringify(schema)}`);
}

function fixture<T>(name: string, overrides: Partial<T>): T {
  return { ...(sample(spec.components.schemas[name]!) as T), ...overrides };
}

export const signupFixture = (overrides: Partial<Signup> = {}): Signup =>
  fixture('SignupDetail', overrides);
export const participantFixture = (overrides: Partial<Participant> = {}): Participant =>
  fixture('Participant', overrides);
export const webhookFixture = (overrides: Partial<Webhook> = {}): Webhook =>
  fixture('WebhookEndpoint', overrides);
export const analyticsFixture = (overrides: Partial<SignupAnalytics> = {}): SignupAnalytics =>
  fixture('AnalyticsResponse', overrides);
export const slotFixture = (overrides: Partial<TimeSlotDto> = {}): TimeSlotDto =>
  fixture('TimeSlot', overrides);
export const itemFixture = (overrides: Partial<ItemDto> = {}): ItemDto =>
  fixture('Item', overrides);
export const meFixture = (overrides: Partial<MeResponse> = {}): MeResponse =>
  fixture('MeResponse', overrides);
export const webhookEventTypes = spec.components.schemas.WebhookEndpoint!.properties!.eventTypes!
  .items!.enum as string[];
