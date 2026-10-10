/**
 * Floating ✨ AI correction button.
 *
 * - Rendered in a Shadow DOM host attached to documentElement (never inside
 *   the page's forms or containers), so page CSS cannot break it and it can
 *   never submit a form.
 * - position:fixed overlay; repositioned on focus/input/scroll/resize.
 * - Never logs text — only metadata via dbg().
 */
import { dbg } from '../utils/logger.js';

export type ButtonState = 'idle' | 'loading' | 'success' | 'error';

const HOST_ID = 'autocorrect-ai-btn-host';
const SIZE = 30;

const SPARKLE_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
<path d="M12 2c.6 4.8 2.6 6.8 7.4 7.4-4.8.6-6.8 2.6-7.4 7.4-.6-4.8-2.6-6.8-7.4-7.4C9.4 8.8 11.4 6.8 12 2Z" fill="currentColor"/>
<path d="M19 3c.3 2.4 1.3 3.4 3.7 3.7-2.4.3-3.4 1.3-3.7 3.7-.3-2.4-1.3-3.4-3.7-3.7 2.4-.3 3.4-1.3 3.7-3.7Z" fill="currentColor" opacity=".8"/>
<path d="M5 15c.4 3 1.6 4.2 4.6 4.6-3 .4-4.2 1.6-4.6 4.6-.4-3-1.6-4.2-4.6-4.6 3-.4 4.2-1.6 4.6-4.6Z" fill="currentColor" opacity=".7"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
<path d="M4 12.5 9.5 18 20 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const CROSS_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const CSS = `
:host { all: initial; }
.acai-btn {
  width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; border: none;
  padding: 0; margin: 0; cursor: pointer; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #5b6cff 0%, #9d6bff 100%);
  color: #fff; box-shadow: 0 2px 10px rgba(91,108,255,.45), 0 1px 3px rgba(0,0,0,.2);
  transition: transform .15s ease, box-shadow .15s ease, background .2s ease;
  font: inherit;
}
.acai-btn:hover { transform: scale(1.12); box-shadow: 0 4px 16px rgba(91,108,255,.6); }
.acai-btn:active { transform: scale(.96); }
.acai-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.acai-btn[data-state="loading"] { cursor: wait; transform: none; }
.acai-btn[data-state="success"] { background: linear-gradient(135deg, #16a34a, #4ade80); }
.acai-btn[data-state="error"] { background: linear-gradient(135deg, #dc2626, #f87171); }
.acai-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
  animation: acai-spin .7s linear infinite;
}
@keyframes acai-spin { to { transform: rotate(360deg); } }
.acai-tip {
  position: absolute; bottom: calc(100% + 8px); right: 0; white-space: nowrap;
  background: #1c2333; color: #fff; font: 600 11px/1.4 system-ui, sans-serif;
  padding: 5px 9px; border-radius: 8px; opacity: 0; pointer-events: none;
  transform: translateY(4px); transition: opacity .15s ease, transform .15s ease;
}
.acai-wrap { position: relative; }
.acai-wrap:hover .acai-tip, .acai-tip[data-show="1"] { opacity: 1; transform: none; }
`;

let host: HTMLElement | null = null;
let btn: HTMLButtonElement | null = null;
let tip: HTMLElement | null = null;
let iconSlot: HTMLElement | null = null;
let clickCb: (() => void) | null = null;
let visible = false;

function ensureHost(): HTMLElement | null {
  if (host?.isConnected) return host;
  try {
    host = document.createElement('div');
    host.id = HOST_ID;
    // Fixed overlay; pointer-events none so it never blocks the page —
    // only the button itself is clickable.
    host.setAttribute(
      'style',
      'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;margin:0;padding:0;'
    );
    // Open (not closed) so automated tests can drive the real button;
    // page CSS still cannot reach inside a shadow root either way.
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'acai-wrap';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'acai-btn';
    btn.dataset.state = 'idle';
    btn.setAttribute('aria-label', 'Correct spelling with AI');
    btn.tabIndex = -1; // never steal keyboard focus order
    iconSlot = document.createElement('span');
    iconSlot.style.display = 'contents';
    iconSlot.innerHTML = SPARKLE_SVG;
    tip = document.createElement('span');
    tip.className = 'acai-tip';
    tip.textContent = 'Correct with AI';
    btn.appendChild(iconSlot);
    // Keep focus in the field when the button is pressed (prevents blur /
    // form side effects) while still delivering the click.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clickCb?.();
    });
    wrap.appendChild(btn);
    wrap.appendChild(tip);
    shadow.appendChild(style);
    shadow.appendChild(wrap);
    // Attached to the root — never inside a form, so it can never submit one.
    (document.documentElement ?? document.body).appendChild(host);
    return host;
  } catch {
    return null;
  }
}

export function setButtonClickHandler(cb: (() => void) | null): void {
  clickCb = cb;
}

export function setButtonState(state: ButtonState, tooltip: string): void {
  if (!btn || !tip || !iconSlot) return;
  btn.dataset.state = state;
  tip.textContent = tooltip;
  tip.dataset.show = state === 'idle' ? '0' : '1';
  if (state === 'loading') iconSlot.innerHTML = '<span class="acai-spinner"></span>';
  else if (state === 'success') iconSlot.innerHTML = CHECK_SVG;
  else if (state === 'error') iconSlot.innerHTML = CROSS_SVG;
  else iconSlot.innerHTML = SPARKLE_SVG;
}

/**
 * Position the button next to `rect` (viewport coords). Prefers inside the
 * right edge; falls back to just outside when the field is narrow.
 */
export function showButtonAt(rect: DOMRect): void {
  const h = ensureHost();
  if (!h) return;
  if (rect.width <= 0 || rect.height <= 0) {
    hideButton();
    return;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Fully offscreen → hide.
  if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
    hideButton();
    return;
  }
  let left: number;
  if (rect.width >= 64) {
    left = rect.right - SIZE - 5; // inside the field
  } else {
    left = rect.right + 6; // just outside
  }
  let top = rect.top + Math.max(0, (rect.height - SIZE) / 2);
  left = Math.max(4, Math.min(vw - SIZE - 4, left));
  top = Math.max(4, Math.min(vh - SIZE - 4, top));
  h.style.display = 'block';
  h.style.left = `${Math.round(left)}px`;
  h.style.top = `${Math.round(top)}px`;
  h.dataset.visible = '1';
  visible = true;
}

export function hideButton(): void {
  if (!host) return;
  host.style.display = 'none';
  host.dataset.visible = '0';
  visible = false;
}

export function isButtonVisible(): boolean {
  return visible && !!host?.isConnected;
}

export function destroyButton(): void {
  try {
    host?.remove();
  } catch {
    /* ignore */
  }
  host = null;
  btn = null;
  tip = null;
  iconSlot = null;
  visible = false;
}

export function logButtonEvent(event: string, extra?: Record<string, unknown>): void {
  dbg(`ai-button: ${event}`, extra);
}
