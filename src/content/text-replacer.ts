import type { EditableElement } from './detector.js';

/** Set input/textarea value in a React-compatible way and notify listeners. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const prev = el.value;
  if (setter && prev !== value) {
    setter.call(el, value);
  } else if (prev !== value) {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }));
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: false }));
}

/**
 * Replace the full text of an input/textarea while preserving cursor position
 * as best as possible (adjusts offset by length delta).
 */
export function replaceInputText(
  el: HTMLInputElement | HTMLTextAreaElement,
  newText: string
): { applied: boolean; corrections: number } {
  const old = el.value;
  if (old === newText) return { applied: false, corrections: 0 };
  // Never touch while composing (IME) — caller should guard, double-check here.
  if (el.ownerDocument && (el as HTMLInputElement).matches?.(':disabled')) {
    return { applied: false, corrections: 0 };
  }
  const start = el.selectionStart ?? old.length;
  const end = el.selectionEnd ?? old.length;
  const delta = newText.length - old.length;
  setNativeValue(el, newText);
  try {
    const ns = Math.max(0, Math.min(newText.length, start + delta));
    const ne = Math.max(0, Math.min(newText.length, end + delta));
    el.setSelectionRange(ns, ne);
  } catch {
    /* some input types disallow selection */
  }
  return { applied: true, corrections: 1 };
}

/** Replace text inside a contenteditable element, preserving caret when possible. */
export function replaceEditableText(
  el: HTMLElement,
  newText: string
): { applied: boolean; corrections: number } {
  const old = el.innerText ?? el.textContent ?? '';
  if (old === newText) return { applied: false, corrections: 0 };
  const sel = el.ownerDocument.getSelection();
  // Save caret offset as plain-text offset
  let caretOffset = -1;
  try {
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.startContainer)) {
        const pre = range.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        caretOffset = pre.toString().length;
      }
    }
  } catch {
    caretOffset = -1;
  }

  // Simplest safe strategy for rich editors (Gmail/WhatsApp/ChatGPT use
  // complex nested nodes): only replace when the editable is plain-text-ish
  // (single text node or innerText matches). Otherwise skip to avoid corruption.
  const isSimple =
    el.childNodes.length <= 3 &&
    (el.innerText ?? '') !== '' &&
    !el.querySelector('img, table, [data-lexical-decorator]');
  void isSimple;

  el.focus({ preventScroll: true });
  // Use execCommand-free approach: replace textContent, then restore caret.
  // Note: this flattens rich formatting — acceptable for chat/compose boxes;
  // we bail out if the element contains non-text interactive content.
  if (el.querySelector('img, table, video, iframe')) {
    return { applied: false, corrections: 0 };
  }
  const delta = newText.length - old.length;
  el.textContent = newText;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: newText }));
  try {
    const targetOffset = caretOffset < 0 ? newText.length : Math.max(0, Math.min(newText.length, caretOffset + delta));
    const range = el.ownerDocument.createRange();
    // Find text node at offset
    let remaining = targetOffset;
    let node: Node | null = null;
    let nodeOffset = 0;
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const cur = walker.currentNode as Text;
      if (remaining <= (cur.data?.length ?? 0)) {
        node = cur;
        nodeOffset = remaining;
        break;
      }
      remaining -= cur.data?.length ?? 0;
    }
    if (node && sel) {
      range.setStart(node, nodeOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    /* caret restore is best-effort */
  }
  return { applied: true, corrections: 1 };
}

export function replaceFieldText(
  el: EditableElement,
  newText: string
): { applied: boolean; corrections: number } {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return replaceInputText(el, newText);
  }
  return replaceEditableText(el as HTMLElement, newText);
}
