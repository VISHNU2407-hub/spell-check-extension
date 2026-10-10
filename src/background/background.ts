import { groqCorrect } from '../correction/ai-correction.js';
import { getApiKey, getSettings, incrementStats, setSettings } from '../utils/storage.js';
import { SUPPORTED_MODELS, DEFAULT_BACKEND_URL } from '../types/index.js';

// Simple in-memory cache for AI results (service worker lifetime).
const cache = new Map<string, string>();

// Last known proxy state (refreshed on startup + opportunistically).
let proxyUp: boolean | null = null;
let proxyHasKey = false;
let lastProxyCheck = 0;

function normalizeBackendUrl(raw: string | undefined): string {
  const fallback = DEFAULT_BACKEND_URL;
  if (!raw || typeof raw !== 'string') return fallback;
  return raw.trim().replace(/\/+$/, '') || fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Check whether the local proxy backend is reachable and keyed. */
export async function checkProxyHealth(
  backendUrl: string
): Promise<{ up: boolean; hasKey: boolean; model?: string }> {
  try {
    const res = await fetchWithTimeout(`${normalizeBackendUrl(backendUrl)}/api/health`, {}, 4000);
    if (!res.ok) return { up: false, hasKey: false };
    const data = (await res.json()) as { ok?: boolean; hasKey?: boolean; model?: string };
    return { up: data?.ok === true, hasKey: data?.hasKey === true, model: data?.model };
  } catch {
    return { up: false, hasKey: false };
  }
}

/** Correct via the local proxy (API key stays server-side). */
async function proxyCorrect(
  backendUrl: string,
  text: string,
  model: string
): Promise<{ ok: boolean; corrected?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      `${normalizeBackendUrl(backendUrl)}/api/correct`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model }),
      },
      20000
    );
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      corrected?: string;
      error?: string;
    } | null;
    if (res.ok && data?.ok && typeof data.corrected === 'string') {
      return { ok: true, corrected: data.corrected };
    }
    return { ok: false, error: data?.error ?? `Proxy error ${res.status}` };
  } catch {
    return { ok: false, error: 'Proxy unreachable' };
  }
}

/**
 * Automatic configuration: if the local proxy is up (key configured
 * server-side from .env), enable AI without any manual key entry —
 * unless the user explicitly switched AI off.
 */
async function autoConfigureAI(): Promise<void> {
  try {
    const settings = await getSettings();
    const health = await checkProxyHealth(settings.backendUrl);
    proxyUp = health.up;
    proxyHasKey = health.hasKey;
    lastProxyCheck = Date.now();
    console.log(
      `[AutoCorrect AI] startup: proxyUp=${health.up} proxyHasKey=${health.hasKey} aiEnabled=${settings.aiEnabled}`
    );
    if (health.up && health.hasKey && !settings.aiUserDisabled && !settings.aiEnabled) {
      await setSettings({ aiEnabled: true });
      console.log('[AutoCorrect AI] proxy detected — AI correction auto-enabled');
    }
    if (!health.up) {
      console.log('[AutoCorrect AI] proxy unreachable — local correction only. Start it: npm run backend');
    }
  } catch {
    proxyUp = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AutoCorrect AI] installed');
  void autoConfigureAI();
});

chrome.runtime.onStartup.addListener(() => {
  void autoConfigureAI();
});

chrome.alarms.onAlarm.addListener(() => {
  /* reserved for future daily stat rollover */
});

type Msg =
  | { type: 'AI_CORRECT'; text: string; requestId?: string; manual?: boolean }
  | { type: 'TEST_CONNECTION' }
  | { type: 'GET_AI_STATUS' }
  | { type: 'REPORT_CORRECTIONS'; count: number };

function cachePut(key: string, value: string): void {
  if (cache.size > 200) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, value);
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg.type === 'REPORT_CORRECTIONS') {
    const n = Math.max(0, Math.min(100, Math.floor(msg.count || 0)));
    if (n > 0) {
      void incrementStats(n);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'GET_AI_STATUS') {
    void (async () => {
      const settings = await getSettings();
      if (Date.now() - lastProxyCheck > 30_000) {
        const health = await checkProxyHealth(settings.backendUrl);
        proxyUp = health.up;
        proxyHasKey = health.hasKey;
        lastProxyCheck = Date.now();
      }
      const key = await getApiKey();
      sendResponse({
        ok: true,
        aiEnabled: settings.aiEnabled,
        via: proxyUp && proxyHasKey ? 'proxy' : key ? 'direct' : 'none',
        proxyUp: proxyUp === true,
        proxyHasKey,
        backendUrl: normalizeBackendUrl(settings.backendUrl),
      });
    })();
    return true;
  }

  if (msg.type === 'TEST_CONNECTION') {
    void (async () => {
      const [key, settings] = await Promise.all([getApiKey(), getSettings()]);
      const backendUrl = normalizeBackendUrl(settings.backendUrl);
      // Preferred route: local proxy (no key needed in the extension).
      const health = await checkProxyHealth(backendUrl);
      proxyUp = health.up;
      proxyHasKey = health.hasKey;
      lastProxyCheck = Date.now();
      if (health.up && health.hasKey) {
        const result = await proxyCorrect(backendUrl, 'Ths is a tset.', settings.model);
        if (result.ok) {
          if (!settings.aiUserDisabled && !settings.aiEnabled) {
            await setSettings({ aiEnabled: true });
          }
          sendResponse({ ok: true, sample: result.corrected, via: 'proxy' });
          return;
        }
        sendResponse({ ok: false, error: `Proxy: ${result.error}`, via: 'proxy' });
        return;
      }
      // Fallback route: direct Groq key pasted in the popup (optional).
      if (!key) {
        sendResponse({
          ok: false,
          error: health.up
            ? 'Proxy has no GROQ_API_KEY — set it in .env and restart the backend'
            : `Proxy unreachable at ${backendUrl} — start it with: npm run backend`,
          via: 'none',
        });
        return;
      }
      const result = await groqCorrect('Ths is a tset.', {
        apiKey: key,
        model: SUPPORTED_MODELS.includes(settings.model) ? settings.model : settings.model,
        timeoutMs: 20000,
      });
      if (result.ok) sendResponse({ ok: true, sample: result.corrected, via: 'direct' });
      else sendResponse({ ok: false, error: result.error, via: 'direct' });
    })();
    return true; // async response
  }

  if (msg.type === 'AI_CORRECT') {
    void (async () => {
      const [key, settings] = await Promise.all([getApiKey(), getSettings()]);
      // Explicit ✨-button clicks carry manual:true — the click itself is
      // user consent, so the aiEnabled gate is bypassed (routing unchanged).
      const manual = (msg as { manual?: boolean }).manual === true;
      if (!settings.aiEnabled && !manual) {
        sendResponse({ ok: false, error: 'AI disabled' });
        return;
      }
      const text: string = typeof msg.text === 'string' ? msg.text : '';
      // Privacy: only send eligible text — cap length, skip huge blobs.
      if (!text.trim() || text.length > 2000) {
        sendResponse({ ok: true, corrected: text });
        return;
      }
      const backendUrl = normalizeBackendUrl(settings.backendUrl);
      const cacheKey = `${settings.model}::${text}`;
      const hit = cache.get(cacheKey);
      if (hit !== undefined) {
        sendResponse({ ok: true, corrected: hit });
        return;
      }
      // Route 1 (preferred): local proxy — extension never sees the API key.
      if (proxyUp !== false) {
        const result = await proxyCorrect(backendUrl, text, settings.model);
        if (result.ok && typeof result.corrected === 'string') {
          proxyUp = true;
          cachePut(cacheKey, result.corrected);
          console.log(
            `[AutoCorrect AI] AI_CORRECT via proxy: textLen=${text.length} outLen=${result.corrected.length}`
          );
          sendResponse({ ok: true, corrected: result.corrected });
          return;
        }
        console.log(`[AutoCorrect AI] AI_CORRECT proxy failed: ${result.error ?? 'unknown'}`);
        proxyUp = result.error === 'Proxy unreachable' ? false : proxyUp;
        // If proxy responded but failed AND no direct key exists, surface it.
        if (!key) {
          sendResponse({ ok: false, error: result.error ?? 'AI failed' });
          return;
        }
      }
      // Route 2 (fallback): direct key stored in the extension (optional).
      if (!key) {
        console.log('[AutoCorrect AI] AI_CORRECT: no AI route available');
        sendResponse({ ok: false, error: 'No AI route available' });
        return;
      }
      const result = await groqCorrect(text, { apiKey: key, model: settings.model });
      if (result.ok && typeof result.corrected === 'string') {
        cachePut(cacheKey, result.corrected);
        console.log(`[AutoCorrect AI] AI_CORRECT via direct: textLen=${text.length}`);
        sendResponse({ ok: true, corrected: result.corrected });
      } else {
        console.log(`[AutoCorrect AI] AI_CORRECT direct failed: ${result.error ?? 'unknown'}`);
        sendResponse({ ok: false, error: result.error ?? 'AI failed' });
      }
    })();
    return true;
  }

  return false;
});
