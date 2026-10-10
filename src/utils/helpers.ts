/** Returns true if hostname matches an exclusion entry (exact or subdomain). */
export function isExcludedSite(hostname: string, excludedSites: string[]): boolean {
  const host = hostname.toLowerCase();
  return excludedSites.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!e) return false;
    return host === e || host.endsWith('.' + e);
  });
}

/** Split text into tokens while preserving separators. */
export function tokenizeWithSeparators(text: string): string[] {
  return text.match(/[A-Za-z']+|[^A-Za-z']+/g) ?? [];
}

/** Count words changed between two strings (word-level diff, capped). */
export function countChangedWords(before: string, after: string): number {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const n = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) changed++;
  }
  return changed;
}

/** Clamp a number to [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Simple debounce helper (for popup/options UI). */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Detect URLs / emails / hashtags / mentions that must never be corrected. */
const PROTECTED_RE =
  /^(https?:\/\/|www\.|ftp:\/\/|mailto:)|@|#|[\w.+-]+@[\w-]+\.[\w.]+|\.\w{2,}$|:\/\//;

export function looksProtected(word: string): boolean {
  if (!word) return true;
  if (/\d/.test(word) && /[A-Za-z]/.test(word) && word.length <= 12 && /^\w+$/.test(word)) {
    // Could be a username/model like "gpt4" — protect unless clearly a typo context.
    // We let the dictionary decide; only protect tokens with digits + uppercase mix.
    if (/[A-Z]/.test(word) && /\d/.test(word)) return true;
  }
  if (PROTECTED_RE.test(word)) return true;
  if (/^['-]|['-]$/.test(word)) return true;
  if (word.includes('/') || word.includes('\\') || word.includes(':')) return true;
  return false;
}

export function preserveCase(original: string, corrected: string): string {
  if (!original || !corrected) return corrected;
  if (original === original.toUpperCase() && original.length > 1) return corrected.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return corrected.charAt(0).toUpperCase() + corrected.slice(1);
  }
  return corrected;
}
