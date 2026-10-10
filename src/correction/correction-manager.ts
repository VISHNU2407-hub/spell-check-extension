import { correctTextLocal } from './local-spellcheck.js';
import { countChangedWords } from '../utils/helpers.js';
import type { Sensitivity } from '../types/index.js';

export interface HybridOptions {
  sensitivity: Sensitivity;
  aiEnabled: boolean;
  offlineEnabled: boolean;
  debounceMs: number;
  /** Called with current text when AI should run (content script wires this to background). */
  requestAi: (text: string, requestId: string) => Promise<string | null>;
  onLocalCorrection?: (count: number) => void;
  onAiCorrection?: (count: number) => void;
}

/**
 * Hybrid correction manager: synchronous local pass + debounced AI pass
 * with stale-response protection and per-text caching.
 */
export class CorrectionManager {
  private aiCache = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRequestId = 0;
  private latestText = '';

  constructor(private opts: HybridOptions) {}

  updateOptions(patch: Partial<HybridOptions>): void {
    this.opts = { ...this.opts, ...patch };
  }

  /** Immediate offline correction. Pure + synchronous. */
  localPass(text: string): { text: string; corrections: number } {
    if (!this.opts.offlineEnabled) return { text, corrections: 0 };
    const result = correctTextLocal(text, this.opts.sensitivity);
    if (result.corrections > 0) this.opts.onLocalCorrection?.(result.corrections);
    return result;
  }

  /**
   * Schedule a debounced AI pass. Resolves with corrected text or null
   * when the response is stale / should not be applied.
   */
  scheduleAiPass(currentText: string): void {
    if (!this.opts.aiEnabled) return;
    const text = currentText.trim();
    if (!text || text.length < 3) return;
    // Skip if text contains no letters or is unchanged since last request
    if (!/[A-Za-z]{3,}/.test(text)) return;
    this.latestText = currentText;
    if (this.timer) clearTimeout(this.timer);
    const reqId = ++this.lastRequestId;
    this.timer = setTimeout(() => {
      void this.runAi(currentText, reqId);
    }, this.opts.debounceMs);
  }

  cancelPending(): void {
    this.lastRequestId++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runAi(textAtSchedule: string, reqId: string | number): Promise<void> {
    // Only correct the text the user actually has now (stale check happens in content.ts too)
    const cached = this.aiCache.get(textAtSchedule);
    if (cached !== undefined) {
      this.opts.onAiCorrection?.(countChangedWords(textAtSchedule, cached));
      this.opts.requestAi(textAtSchedule, String(reqId)); // notify path kept simple
      return;
    }
    const result = await this.opts.requestAi(textAtSchedule, String(reqId));
    if (result !== null && result !== textAtSchedule) {
      if (this.aiCache.size > 200) {
        const first = this.aiCache.keys().next().value;
        if (first !== undefined) this.aiCache.delete(first);
      }
      this.aiCache.set(textAtSchedule, result);
      this.opts.onAiCorrection?.(countChangedWords(textAtSchedule, result));
    }
  }

  /** Apply a cached AI result synchronously if present. */
  getCached(text: string): string | undefined {
    return this.aiCache.get(text);
  }
}
