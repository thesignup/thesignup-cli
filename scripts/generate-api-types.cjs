const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const prettier = require('prettier');

const root = join(__dirname, '..');
const source = JSON.parse(readFileSync(join(root, 'api/openapi.json'), 'utf8'));
const schemas = source.components.schemas;
const names = new Set([
  'SignupSummary',
  'SignupDetail',
  'Participant',
  'AnalyticsResponse',
  'WebhookEndpoint',
  'CreateOrRotateWebhookResponse',
  'MeResponse',
  'Item',
  'TimeSlot',
  'ListSignupsResponse',
  'ListParticipantsResponse',
  'ListWebhooksResponse',
  'ListItemsResponse',
  'ListTimeSlotsResponse',
  'FromDescriptionResponse',
]);

function render(schema) {
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (!schemas[name]) throw new Error(`Unknown schema ${name}`);
    names.add(name);
    return name;
  }
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.oneOf) return schema.oneOf.map(render).join(' | ');
  if (schema.allOf) {
    const nullable = schema.allOf.some((part) => part.type?.includes('null'));
    const parts = schema.allOf.filter(
      (part) => !part.type?.includes('null') && (part.$ref || part.type || part.oneOf),
    );
    const intersection = parts.map(render).join(' & ');
    return nullable ? `${intersection} | null` : intersection;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => render({ ...schema, type })).join(' | ');
  }
  if (schema.type === 'array') return `(${render(schema.items)})[]`;
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(
      ([key, value]) => `  ${key}${required.has(key) ? '' : '?'}: ${render(value)};`,
    );
    return `{\n${properties.join('\n')}\n}`;
  }
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'string' || schema.type === 'boolean' || schema.type === 'null')
    return schema.type;
  throw new Error(`Unsupported schema: ${JSON.stringify(schema)}`);
}

const declarations = [];
while (names.size > declarations.length) {
  const name = [...names][declarations.length];
  declarations.push(`export type ${name} = ${render(schemas[name])};`);
}

const sourceText = [
  '// Generated from api/openapi.json by scripts/generate-api-types.cjs. Do not edit.',
  ...declarations,
  "export type SignupStatus = SignupSummary['status'];",
  'export type Signup = SignupDetail;',
  'export type SignupAnalytics = AnalyticsResponse;',
  'export type Webhook = WebhookEndpoint;',
  'export type TimeSlotDto = TimeSlot;',
  'export type ItemDto = Item;',
  'export type ListSlotsResponse = ListTimeSlotsResponse;',
  'export type AiDraftResponse = FromDescriptionResponse;',
  '',
  'export type WebhookEventType = ' +
    schemas.WebhookEndpoint.properties.eventTypes.items.enum
      .map((value) => JSON.stringify(value))
      .join(' | ') +
    ';',
  'export interface WebhookEvent {\n  id: string;\n  type: WebhookEventType;\n  created: number;\n  organizationId: string;\n  data: Record<string, unknown>;\n}',
  '',
].join('\n\n');
const target = join(root, 'src/api/types.ts');
prettier
  .format(sourceText, {
    ...JSON.parse(readFileSync(join(root, '.prettierrc'), 'utf8')),
    parser: 'typescript',
  })
  .then((output) => {
    if (process.argv.includes('--check')) {
      if (readFileSync(target, 'utf8') !== output) {
        console.error('API types are stale. Run node scripts/generate-api-types.cjs.');
        process.exitCode = 1;
      }
    } else {
      writeFileSync(target, output);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
