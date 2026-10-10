/** Field detection: which elements are safe + eligible for autocorrect. */

export type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const SENSITIVE_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-cvv',
  'cc-name', 'cc-type', 'new-password', 'current-password', 'one-time-code',
  'otp', 'ssn', 'credit-card', 'card-number', 'card-expiry', 'cvv', 'cvc',
]);

const SENSITIVE_NAME_RE =
  /(pass|pwd|card|cc-?num|cvv|cvc|expir|otp|token|ssn|social-?sec|pin-code|secret|credential|iban|account-?num|routing)/i;

const CODE_EDITOR_SELECTORS = [
  '.CodeMirror',
  '.monaco-editor',
  '.ace_editor',
  '[data-language]',
  '[data-mode]',
  'pre code',
  'code',
];

export function isCodeEditor(el: Element): boolean {
  try {
    for (const sel of CODE_EDITOR_SELECTORS) {
      if (el.matches?.(sel)) return true;
      if (el.closest?.(sel)) {
        // Allow correction inside comments? No — safest to skip editors entirely.
        return true;
      }
    }
    if (el.closest?.('.CodeMirror, .monaco-editor, .ace_editor')) return true;
    const role = el.getAttribute?.('role');
    if (role === 'code' || role === 'terminal') return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isSensitiveField(el: Element): boolean {
  const input = el as HTMLInputElement;
  const type = (input.type ?? '').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;
  if (type === 'number' && /otp|code|pin|cvv|cvc/i.test(input.name + input.id)) return true;

  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE.has(autocomplete)) return true;

  const haystack = `${input.name ?? ''} ${input.id ?? ''} ${input.placeholder ?? ''} ${
    input.getAttribute?.('aria-label') ?? ''
  }`;
  if (SENSITIVE_NAME_RE.test(haystack)) {
    // Avoid false positives like "passport" field? "pass" matches passport.
    // Require the sensitive keyword to not be part of a larger innocent word.
    if (/passport|passwordless/i.test(haystack)) {
      // "passport number" is still sensitive-ish; skip to be safe.
      return true;
    }
    return true;
  }
  if (input.inputMode === 'numeric' && /otp|code|pin|2fa/i.test(haystack)) return true;
  return false;
}

export function isEditable(el: EventTarget | Element | null): el is EditableElement {
  if (!el || !(el instanceof Element)) return false;
  if (isSensitiveField(el)) return false;
  if (isCodeEditor(el)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const t = ((el as HTMLInputElement).type ?? 'text').toLowerCase();
    if (['password', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'range', 'color', 'date', 'datetime-local', 'month', 'week', 'time'].includes(t)) {
      return false;
    }
    if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return false;
    return true;
  }
  if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement;
    if (ta.readOnly || ta.disabled) return false;
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    if ((el as HTMLElement).dataset?.autocorrectAiSkip === '1') return false;
    return true;
  }
  return false;
}

export function getFieldText(el: EditableElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return (el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? '';
}

export function describeField(el: EditableElement): string {
  if (el instanceof HTMLInputElement) return `input[type=${el.type}]`;
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  return 'contenteditable';
}
