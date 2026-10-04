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
  if (
    res.status === 403 &&
    /(?:^|,\s*)Bearer\b/i.test(challenge) &&
    /(?:^|[\s,])error\s*=\s*"?insufficient_scope"?(?=\s*(?:,|$))/i.test(challenge)
  ) {
    const scope = /(?:^|[\s,])scope\s*=\s*"([^"]+)"/i.exec(challenge)?.[1];
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
