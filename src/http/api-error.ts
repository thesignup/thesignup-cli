export interface ApiErrorBody {
  error?: string;
  message?: string;
  detail?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: ApiErrorBody;
  constructor(status: number, message: string, body?: ApiErrorBody, code?: string) {
    super(message);
    this.status = status;
    if (body !== undefined) this.body = body;
    if (code !== undefined) this.code = code;
  }
}

export async function responseError(res: Response): Promise<ApiError> {
  const challenge = res.headers.get('www-authenticate') ?? '';
  const scope = res.status === 403 ? missingBearerScope(challenge) : undefined;
  if (scope !== undefined) {
    return new ApiError(
      res.status,
      `Your login lacks ${scope ? `the ${scope} scope` : 'a required scope'} — run \`thesignup auth login\` again`,
      undefined,
      'insufficient_scope',
    );
  }

  const text = await res.text().catch(() => '');
  let body: ApiErrorBody | undefined;
  try {
    body = text ? (JSON.parse(text) as ApiErrorBody) : undefined;
  } catch {
    body = { message: text };
  }
  const message = body?.message ?? body?.detail ?? body?.error ?? `HTTP ${res.status}`;
  return new ApiError(res.status, message, body, body?.code ?? body?.error);
}

function missingBearerScope(header: string): string | undefined {
  let bearer = false;
  let error: string | undefined;
  let scope: string | undefined;
  const result = (): string | undefined =>
    bearer && error?.toLowerCase() === 'insufficient_scope' ? (scope ?? '') : undefined;

  for (const part of splitAuthParams(header)) {
    const scheme = /^([a-z][\w-]*)\s+(.+)$/i.exec(part);
    let param = part;
    if (scheme && !scheme[2]?.startsWith('=')) {
      const previous = result();
      if (previous !== undefined) return previous;
      bearer = scheme[1]?.toLowerCase() === 'bearer';
      error = undefined;
      scope = undefined;
      param = scheme[2]!;
    }
    if (!bearer) continue;
    const pair = /^([a-z][\w-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^\s"]+))$/i.exec(param);
    if (pair?.[1]?.toLowerCase() === 'error') error = pair[2] ?? pair[3];
    if (pair?.[1]?.toLowerCase() === 'scope') scope = pair[2] ?? pair[3];
  }
  return result();
}

function splitAuthParams(header: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < header.length; i++) {
    if (header[i] === '\\' && quoted && !escaped) {
      escaped = true;
      continue;
    }
    if (header[i] === '"' && !escaped) quoted = !quoted;
    escaped = false;
    if (header[i] === ',' && !quoted) {
      parts.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(header.slice(start).trim());
  return parts;
}
