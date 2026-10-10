/**
 * Shared helpers for the AutoCorrect AI local proxy backend.
 * Plain Node (no dependencies). Never logs secrets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8787;
export const MAX_TEXT_LENGTH = 2000;

/** Parse `KEY=VALUE` lines (supports quotes + comments). Pure — unit tested. */
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

/**
 * Load `.env` from the project root into process.env (without overriding
 * real environment variables). Never prints values.
 */
export function loadEnvFile() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const candidates = [join(root, '.env'), join(root, 'backend', '.env')];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const parsed = parseEnvText(readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
      console.log(`[proxy] loaded env file: ${file}`);
      return file;
    } catch (err) {
      console.error(`[proxy] could not read ${file}: ${err?.message ?? err}`);
    }
  }
  return null;
}

/** Validate a POST /api/correct body. Pure — unit tested. */
export function validateCorrectBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON body' };
  const { text, model } = body;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'Field "text" must be a non-empty string' };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `Field "text" exceeds ${MAX_TEXT_LENGTH} characters` };
  }
  if (
    model !== undefined &&
    (typeof model !== 'string' ||
      model.includes('..') ||
      !/^[a-z0-9._/-]{1,80}$/i.test(model))
  ) {
    return { ok: false, error: 'Field "model" is invalid' };
  }
  return { ok: true };
}

/** Build the Groq request payload. The API key is only attached server-side. */
export function buildGroqPayload(text, model, systemPrompt) {
  return {
    model,
    temperature: 0,
    max_tokens: 512,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
  };
}
