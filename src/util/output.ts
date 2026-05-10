export type OutputFormat = 'pretty' | 'json';

export interface OutputContext {
  format: OutputFormat;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

export function makeOutput(opts: { json?: boolean | undefined } = {}): OutputContext {
  return {
    format: opts.json ? 'json' : 'pretty',
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

export function emit(ctx: OutputContext, payload: unknown, prettyLines: string[] | string): void {
  if (ctx.format === 'json') {
    ctx.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  const lines = Array.isArray(prettyLines) ? prettyLines : [prettyLines];
  for (const line of lines) ctx.stdout.write(line + '\n');
}

export function emitError(ctx: OutputContext, message: string, code?: string): void {
  if (ctx.format === 'json') {
    ctx.stderr.write(JSON.stringify({ error: code ?? 'error', message }) + '\n');
    return;
  }
  ctx.stderr.write(`error: ${message}\n`);
}
