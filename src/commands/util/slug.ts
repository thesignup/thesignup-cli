export function extractSignupRef(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('signup reference is empty');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (!last) throw new Error(`could not extract a slug from URL: ${trimmed}`);
    return last;
  }
  return trimmed;
}
