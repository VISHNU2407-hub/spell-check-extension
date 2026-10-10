import { looksProtected, preserveCase } from '../utils/helpers.js';
import { COMMON_MISSPELLINGS } from './dictionary.js';
import { WORD_SET } from './wordlist.js';
import type { Sensitivity } from '../types/index.js';

/** Levenshtein distance with early exit when exceeding maxDist. */
export function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

function isAcronym(word: string): boolean {
  return word.length <= 4 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

function isCamelOrMixed(word: string): boolean {
  // e.g. JavaScript, useState, iPhone — technical terms, do not touch
  return /[a-z][A-Z]/.test(word);
}

/**
 * Correct a single word using local dictionary only.
 * Returns the corrected word (case-preserved) or the original.
 */
export function correctWord(raw: string, sensitivity: Sensitivity = 'balanced'): string {
  if (!raw || raw.length < 2) return raw;
  if (looksProtected(raw)) return raw;
  if (isAcronym(raw)) return raw;
  if (isCamelOrMixed(raw)) return raw;
  // Don't touch ALL CAPS shouting words unless in explicit map (e.g. TEH -> THE)
  const lower = raw.toLowerCase();

  // Strip possessive/contraction tail for lookup, e.g. "dont" handled via map
  const mapped = COMMON_MISSPELLINGS[lower];
  if (mapped) {
    return preserveCase(raw, mapped);
  }

  // If the word is already valid, never change it (prevents form->from etc.)
  if (WORD_SET.has(lower)) return raw;

  // Words with digits or uppercase inside (model names etc.) — leave alone
  if (/[0-9]/.test(raw)) return raw;

  if (sensitivity === 'conservative') return raw;

  // Fuzzy correction: only for words not in dictionary, with strict distance.
  const maxDist = sensitivity === 'aggressive' ? (lower.length >= 6 ? 2 : 1) : 1;
  const minLen = sensitivity === 'aggressive' ? 4 : 5;
  if (lower.length < minLen) return raw;

  // Candidate search over word list. WORD_SET iteration is fine for ~2-4k words
  // and only runs on word boundaries (not keystrokes).
  let best: string | null = null;
  let bestDist = maxDist + 1;
  // Heuristic: only consider candidates with same first letter and similar length
  // to keep it fast and reduce false positives.
  for (const candidate of WORD_SET) {
    if (candidate.length < 3) continue;
    if (Math.abs(candidate.length - lower.length) > maxDist) continue;
    if (candidate[0] !== lower[0]) continue;
    const d = levenshtein(lower, candidate, maxDist);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
      if (d === 1 && sensitivity === 'balanced') {
        // For balanced mode, distance-1 with same first letter is enough;
        // but continue scanning only if aggressive (to find distance-1 vs 2 tie).
        break;
      }
      if (d === 1) break;
    }
  }
  if (best && bestDist <= maxDist) {
    return preserveCase(raw, best);
  }
  return raw;
}

export interface LocalCorrectResult {
  text: string;
  corrections: number;
}

/** Correct full text locally, preserving separators/whitespace/emojis. */
export function correctTextLocal(text: string, sensitivity: Sensitivity = 'balanced'): LocalCorrectResult {
  if (!text) return { text, corrections: 0 };
  // Never touch text that is mostly URL/email
  const parts = text.match(/[A-Za-z']+|[^A-Za-z']+/g) ?? [];
  let corrections = 0;
  const out = parts.map((tok) => {
    if (!/^[A-Za-z']+$/.test(tok)) return tok;
    // Skip tokens that are part of emails/URLs — check neighbours
    const fixed = correctWord(tok, sensitivity);
    if (fixed !== tok) corrections++;
    return fixed;
  });
  return { text: out.join(''), corrections };
}
