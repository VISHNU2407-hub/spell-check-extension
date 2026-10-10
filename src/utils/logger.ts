/**
 * Metadata-only debug logger.
 *
 * Privacy rule: NEVER pass user text, field values, words, API keys, or URLs
 * with query strings. Log lengths, counts, booleans, and field descriptors.
 */
let enabled = true;

export function setDebugEnabled(v: boolean): void {
  enabled = v === true;
}

export function isDebugEnabled(): boolean {
  return enabled;
}

export function dbg(event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    if (data === undefined) console.debug(`[AutoCorrect AI] ${event}`);
    else console.debug(`[AutoCorrect AI] ${event} ${JSON.stringify(data)}`);
  } catch {
    /* logging must never break correction */
  }
}
