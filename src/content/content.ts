import { isEditable, getFieldText, describeField, type EditableElement } from './detector.js';
import { replaceFieldText } from './text-replacer.js';
import { correctTextLocal } from '../correction/local-spellcheck.js';
import { isSafeAiReplacement } from '../correction/ai-correction.js';
import { isExcludedSite, countChangedWords, clamp } from '../utils/helpers.js';
import { dbg, setDebugEnabled } from '../utils/logger.js';
import { shouldShowButton } from './button-policy.js';
import {
  setButtonClickHandler,
  setButtonState,
  showButtonAt,
  hideButton,
  isButtonVisible,
  logButtonEvent,
  type ButtonState,
} from './floating-button.js';
import type { ExtensionSettings } from '../types/index.js';
import { DEFAULT_BACKEND_URL, DEFAULT_MODEL } from '../types/index.js';

let settings: ExtensionSettings = {
  extensionEnabled: true,
  autoCorrectEnabled: true,
  aiEnabled: false,
  offlineEnabled: true,
  sensitivity: 'balanced',
  debounceMs: 900,
  language: 'en',
  model: DEFAULT_MODEL,
  excludedSites: [],
  backendUrl: DEFAULT_BACKEND_URL,
  aiUserDisabled: false,
  debugLogging: true,
  showAiButton: true,
  correctionMode: 'click',
};

let composing = false;
let aiTimer: ReturnType<typeof setTimeout> | undefined;
let aiRequestSeq = 0;
let lastAiSnapshot = new Map<EditableElement, string>();

// Floating-button state.
let activeField: EditableElement | null = null;
let buttonBusy = false;
let buttonRunSeq = 0;

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(null);
    settings = { ...settings, ...stored };
    setDebugEnabled(settings.debugLogging !== false);
    updateButton();
  } catch {
    /* storage may be unavailable very early — keep defaults */
  }
}

function siteExcluded(): boolean {
  try {
    return isExcludedSite(location.hostname, settings.excludedSites ?? []);
  } catch {
    return false;
  }
}

function eligible(el: EditableElement | null): el is EditableElement {
  if (!el) return false;
  if (!settings.extensionEnabled || !settings.autoCorrectEnabled) return false;
  if (siteExcluded()) return false;
  return isEditable(el);
}

function reportCorrections(count: number): void {
  if (count <= 0) return;
  chrome.runtime.sendMessage({ type: 'REPORT_CORRECTIONS', count }).catch(() => undefined);
}

/** Local pass: correct the word just finished (before the boundary char). */
function localWordBoundaryPass(el: EditableElement, source: string): number {
  if (!settings.offlineEnabled) return 0;
  const field = describeField(el);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const m = before.match(/([A-Za-z']+)([ \n\r\t.,!?;:)"'\]])$/);
    if (!m) {
      dbg('local-pass: no boundary word', { field, source, caretPos: pos, textLen: el.value.length });
      return 0;
    }
    const word = m[1];
    const { text } = correctTextLocal(word, settings.sensitivity);
    if (text !== word) {
      const start = pos - m[0].length;
      const newValue = el.value.slice(0, start) + text + el.value.slice(start + word.length);
      // Preserve caret: it sits right after the boundary char.
      const caret = pos + (text.length - word.length);
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, newValue);
      else el.value = newValue;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      dbg('local-pass: corrected', { field, source, wordLen: word.length, fixedLen: text.length });
      reportCorrections(1);
      return 1;
    }
    dbg('local-pass: word already correct', { field, source, wordLen: word.length });
    return 0;
  } else {
    // contenteditable: run local pass over whole text but only apply if
    // change is confined to the last word (safe + cheap).
    const html = el as HTMLElement;
    const current = html.innerText ?? html.textContent ?? '';
    const { text: fixed, corrections } = correctTextLocal(current, settings.sensitivity);
    if (corrections > 0 && fixed !== current) {
      // Only auto-apply if the diff is at the tail (word just finished).
      const tailChange =
        current.slice(0, Math.min(current.length, fixed.length) - 20) ===
        fixed.slice(0, Math.min(current.length, fixed.length) - 20);
      if (tailChange || current.length < 200) {
        const r = replaceFieldText(el, fixed);
        dbg('local-pass: contenteditable replace', {
          field,
          source,
          applied: r.applied,
          corrections,
          textLen: current.length,
        });
        if (r.applied) reportCorrections(corrections);
        return r.applied ? corrections : 0;
      }
      dbg('local-pass: contenteditable change not at tail, skipped', {
        field,
        source,
        corrections,
      });
      return 0;
    }
    return 0;
  }
}

function scheduleAi(el: EditableElement): void {
  if (!settings.aiEnabled) return;
  if (aiTimer) clearTimeout(aiTimer);
  const delay = clamp(settings.debounceMs ?? 900, 300, 5000);
  aiTimer = setTimeout(() => void runAiPass(el), delay);
}

async function runAiPass(el: EditableElement): Promise<void> {
  if (!eligible(el)) {
    dbg('ai-pass: field no longer eligible, skip');
    return;
  }
  const snapshot = getFieldText(el);
  const text = snapshot.trim();
  if (text.length < 8 || !/[A-Za-z]{3,}/.test(text)) {
    dbg('ai-pass: text too short, skip', { textLen: snapshot.length });
    return;
  }
  if (lastAiSnapshot.get(el) === text) {
    dbg('ai-pass: already checked, skip', { textLen: snapshot.length });
    return; // already checked
  }
  lastAiSnapshot.set(el, text);
  const reqId = ++aiRequestSeq;
  dbg('ai-pass: requesting', { reqId, textLen: snapshot.length });

  let response: { ok: boolean; corrected?: string; error?: string } | undefined;
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'AI_CORRECT',
      text: snapshot,
      requestId: String(reqId),
    })) as typeof response;
  } catch {
    dbg('ai-pass: background unreachable');
    return; // background unavailable — local correction already applied
  }
  if (!response?.ok || typeof response.corrected !== 'string') {
    dbg('ai-pass: backend error', { error: response?.error ?? 'unknown' });
    return;
  }
  // Stale check: user kept typing while AI was working → drop response.
  if (reqId !== aiRequestSeq) {
    dbg('ai-pass: stale response dropped', { reqId });
    return;
  }
  const current = getFieldText(el);
  if (current !== snapshot) {
    dbg('ai-pass: text changed during request, dropped');
    return;
  }
  const corrected = response.corrected;
  if (corrected === snapshot) {
    dbg('ai-pass: already correct');
    return;
  }
  if (!isSafeAiReplacement(snapshot, corrected)) {
    dbg('ai-pass: unsafe replacement rejected', {
      beforeLen: snapshot.length,
      afterLen: corrected.length,
    });
    return;
  }
  if (!eligible(el)) {
    dbg('ai-pass: field no longer eligible at apply time');
    return;
  }
  const r = replaceFieldText(el, corrected);
  dbg('ai-pass: applied', { applied: r.applied, beforeLen: snapshot.length, afterLen: corrected.length });
  if (r.applied) reportCorrections(Math.max(1, countChangedWords(snapshot, corrected)));
}

function onKeyDown(e: KeyboardEvent): void {
  const el = e.target as EditableElement;
  if (!eligible(el)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Word-boundary correction itself runs in the `input` handler (robust even
  // when keydown is missing or throttled, e.g. virtual keyboards). Here we
  // only log boundary keys for diagnostics — key value is a single char max
  // and never user text beyond the boundary character itself.
  if (e.key === ' ' || e.key === 'Enter' || /^[.,!?;:)"'\]]$/.test(e.key)) {
    dbg('boundary key detected', { field: describeField(el) });
  }
}

function onInput(e: Event): void {
  const el = e.target as EditableElement;
  if (!eligible(el)) return;
  if (composing) return;
  dbg('input event', { field: describeField(el) });
  // In "Click to Correct" mode there is no automatic text replacement at
  // all — corrections happen only via the ✨ button (no API calls either).
  const clickOnly = settings.correctionMode === 'click';
  if (!clickOnly) {
    // Local word-boundary pass runs here (not on a rAF-after-keydown timer) so
    // correction works even if keydown never fires or frames are throttled.
    localWordBoundaryPass(el, 'input');
  }
  updateButton();
  if (clickOnly) return;
  // Paste of large text: still allow local pass but skip AI for huge blobs.
  const text = getFieldText(el);
  if (text.length > 2000) {
    dbg('input: text too long, AI skipped', { textLen: text.length });
    return;
  }
  scheduleAi(el);
}

// ---------------------------------------------------------------------------
// Floating ✨ AI button
// ---------------------------------------------------------------------------

/** Recompute button visibility + position for the active field. */
function updateButton(): void {
  if (!activeField || !activeField.isConnected) {
    hideButton();
    stopWatch();
    return;
  }
  const fieldEligible = eligible(activeField);
  const text = fieldEligible ? getFieldText(activeField) : '';
  const show = shouldShowButton({
    extensionEnabled: settings.extensionEnabled,
    showAiButton: settings.showAiButton !== false,
    siteExcluded: siteExcluded(),
    fieldEligible,
    hasText: text.trim().length > 0,
    isBusy: buttonBusy,
  });
  if (!show) {
    hideButton();
    stopWatch();
    return;
  }
  try {
    showButtonAt((activeField as HTMLElement).getBoundingClientRect());
    ensureWatch();
  } catch {
    hideButton();
    stopWatch();
  }
}

// Position watchdog: while the button is visible, re-sync its position on a
// lightweight interval. Scroll/resize events are the primary trigger, but
// event delivery can stall (occluded windows, coalesced programmatic
// scrolls) — a single rect read 4x/second while visible is negligible and
// guarantees the button never floats detached from its field.
let watchTimer: ReturnType<typeof setInterval> | undefined;
function ensureWatch(): void {
  if (watchTimer !== undefined) return;
  watchTimer = setInterval(() => {
    try {
      if (isButtonVisible()) {
        updateButton();
      } else {
        stopWatch();
      }
    } catch {
      /* never break the page */
    }
  }, 250);
}
function stopWatch(): void {
  if (watchTimer !== undefined) {
    clearInterval(watchTimer);
    watchTimer = undefined;
  }
}

function onFocusIn(e: FocusEvent): void {
  const el = e.target as EditableElement;
  if (eligible(el)) {
    activeField = el;
    dbg('field focused', { field: describeField(el) });
  }
  updateButton();
}

function onFocusOut(): void {
  // The button's mousedown is prevented, so clicking ✨ never blurs the
  // field — a real blur here means the user left the field.
  setTimeout(() => {
    const ae = document.activeElement as EditableElement | null;
    if (ae && eligible(ae)) {
      activeField = ae;
    } else {
      activeField = null;
    }
    if (!buttonBusy) updateButton();
  }, 0);
}

let lastReposition = 0;
let scrollEventsSeen = 0;
function queueReposition(): void {
  // Time-throttled synchronous reposition (NOT rAF): rAF stops firing when
  // the tab is occluded, which would freeze the button mid-scroll.
  // updateButton() is a single rect read + style write — cheap per frame.
  const now = Date.now();
  scrollEventsSeen++;
  try {
    // Diagnostics counter (test-visible; no text involved).
    document.documentElement.dataset.acaiScrolls = String(scrollEventsSeen);
  } catch {
    /* ignore */
  }
  if (now - lastReposition < 32) return;
  lastReposition = now;
  dbg('button reposition on scroll', { scrollY: window.scrollY });
  updateButton();
}

/** Offline fallback used when Groq is unavailable or rejects the text. */
function applyLocalFallback(el: EditableElement, snapshot: string): { state: ButtonState; tip: string } {
  if (!settings.offlineEnabled) return { state: 'error', tip: 'Correction failed' };
  const { text: fixed, corrections } = correctTextLocal(snapshot, settings.sensitivity);
  if (corrections > 0 && fixed !== snapshot) {
    const r = replaceFieldText(el, fixed);
    if (r.applied) {
      reportCorrections(corrections);
      logButtonEvent('fallback local applied', { corrections });
      return { state: 'success', tip: 'Corrected!' };
    }
  }
  return { state: 'error', tip: 'Correction failed' };
}

function resetButtonSoon(): void {
  setTimeout(() => {
    if (!buttonBusy) setButtonState('idle', 'Correct with AI');
  }, 1800);
}

/**
 * Click-to-correct: read the active field, correct via Groq (explicit user
 * consent — `manual: true` bypasses the aiEnabled gate), and safely replace.
 */
async function correctViaButton(): Promise<void> {
  const el = activeField;
  const runId = ++buttonRunSeq;
  logButtonEvent('button clicked', { runId, busy: buttonBusy });
  if (!el || !el.isConnected || buttonBusy) {
    logButtonEvent('click ignored', { runId });
    return;
  }
  if (!eligible(el)) {
    updateButton();
    return;
  }
  const snapshot = getFieldText(el);
  if (!snapshot.trim()) {
    updateButton();
    return;
  }
  buttonBusy = true;
  updateButton(); // keep visible during the request
  setButtonState('loading', 'Correcting...');
  logButtonEvent('correct start', { runId, field: describeField(el), textLen: snapshot.length });

  let response: { ok: boolean; corrected?: string; error?: string } | undefined;
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'AI_CORRECT',
      text: snapshot,
      manual: true,
    })) as typeof response;
  } catch {
    response = { ok: false, error: 'Background unreachable' };
  }

  // Stale-response protection: never overwrite text that changed, and never
  // touch a field the user has left.
  if (!el.isConnected || activeField !== el) {
    logButtonEvent('stale: field switched, dropped', { runId });
    buttonBusy = false;
    setButtonState('idle', 'Correct with AI');
    updateButton();
    return;
  }
  const current = getFieldText(el);
  if (current !== snapshot) {
    logButtonEvent('stale: text changed during request, dropped', { runId });
    buttonBusy = false;
    setButtonState('idle', 'Correct with AI');
    updateButton();
    return;
  }

  let state: ButtonState = 'success';
  let tip = 'Corrected!';
  const aiOk = response?.ok === true && typeof response?.corrected === 'string';
  if (aiOk) {
    const corrected = (response as { corrected: string }).corrected;
    if (corrected === snapshot) {
      tip = 'Looks good!';
      logButtonEvent('already correct', { runId });
    } else if (isSafeAiReplacement(snapshot, corrected)) {
      const r = replaceFieldText(el, corrected);
      if (r.applied) {
        reportCorrections(Math.max(1, countChangedWords(snapshot, corrected)));
        logButtonEvent('ai applied', { runId, beforeLen: snapshot.length, afterLen: corrected.length });
      } else {
        state = 'error';
        tip = 'Correction failed';
        logButtonEvent('replace failed (unsupported editor)', { runId });
      }
    } else {
      logButtonEvent('ai unsafe, trying local fallback', { runId });
      ({ state, tip } = applyLocalFallback(el, snapshot));
    }
  } else {
    logButtonEvent('ai failed, trying local fallback', { error: response?.error ?? 'unknown' });
    ({ state, tip } = applyLocalFallback(el, snapshot));
  }

  buttonBusy = false;
  setButtonState(state, tip);
  resetButtonSoon();
  updateButton();
}

function onCompositionStart(): void {
  composing = true;
  if (aiTimer) clearTimeout(aiTimer);
}
function onCompositionEnd(e: Event): void {
  composing = false;
  const el = e.target as EditableElement;
  if (!eligible(el)) return;
  scheduleAi(el);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SETTINGS_UPDATED') {
    void loadSettings();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  for (const k of Object.keys(changes)) {
    if (k in settings || k === 'stats') {
      void loadSettings();
      break;
    }
  }
});

void loadSettings().then(() => {
  dbg('content script initialized', {
    host: location.hostname,
    topFrame: window.top === window,
    extensionEnabled: settings.extensionEnabled,
    autoCorrectEnabled: settings.autoCorrectEnabled,
    offlineEnabled: settings.offlineEnabled,
    aiEnabled: settings.aiEnabled,
    sensitivity: settings.sensitivity,
  });
});
// Marker for automated browser tests (and manual console verification).
// NOTE: content scripts run in an isolated JS world, so a window property is
// invisible to page scripts — the DOM dataset attribute is shared and is the
// reliable presence signal. Check: document.documentElement.dataset.autocorrectAi
try {
  document.documentElement.dataset.autocorrectAi = '1.0.0';
} catch {
  /* ignore */
}
(window as unknown as { __autocorrectAI?: object }).__autocorrectAI = {
  loaded: true,
  version: '1.0.0',
};
document.addEventListener('keydown', onKeyDown, true);
document.addEventListener('input', onInput, true);
document.addEventListener('focusin', onFocusIn, true);
document.addEventListener('focusout', onFocusOut, true);
document.addEventListener('compositionstart', onCompositionStart, true);
document.addEventListener('compositionend', onCompositionEnd, true);
// Reposition the floating button without layout thrash (rAF-throttled,
// passive — no impact on typing).
document.addEventListener('scroll', queueReposition, { capture: true, passive: true });
window.addEventListener('scroll', queueReposition, { passive: true });
window.addEventListener('resize', queueReposition);
setButtonClickHandler(() => void correctViaButton());
