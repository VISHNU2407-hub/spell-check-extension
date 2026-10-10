import { DEFAULT_SETTINGS, DEFAULT_STATS, DEFAULT_MODEL, RETIRED_MODELS, type ExtensionSettings, type ExtensionStats } from '../types/index.js';

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof ExtensionSettings)[];

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get([...SETTINGS_KEYS]);
  const merged = { ...DEFAULT_SETTINGS, ...stored } as ExtensionSettings;
  // Migrate retired Groq models to the current default (Groq 404s them).
  if (typeof merged.model === 'string' && RETIRED_MODELS.includes(merged.model)) {
    merged.model = DEFAULT_MODEL;
    await chrome.storage.local.set({ model: merged.model });
  }
  return merged;
}

export async function setSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  await chrome.storage.local.set(patch);
  // Notify all tabs that settings changed (best-effort)
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((t) =>
        t.id !== undefined
          ? chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED' }).catch(() => undefined)
          : Promise.resolve()
      )
    );
  } catch {
    // ignore — content scripts also poll settings on focus
  }
}

export async function getApiKey(): Promise<string> {
  const { groqApiKey } = await chrome.storage.local.get('groqApiKey');
  return typeof groqApiKey === 'string' ? groqApiKey.trim() : '';
}

export async function setApiKey(key: string): Promise<void> {
  // NOTE: keys stored in chrome.storage.local are NOT encrypted and are
  // readable by any code running in the extension context. Never commit keys
  // to git. For publicly distributed builds, use a backend proxy instead of
  // shipping a shared key.
  await chrome.storage.local.set({ groqApiKey: key.trim() });
}

export async function getStats(): Promise<ExtensionStats> {
  const { stats } = await chrome.storage.local.get('stats');
  const merged: ExtensionStats = { ...DEFAULT_STATS, ...(stats ?? {}) };
  const today = new Date().toISOString().slice(0, 10);
  if (merged.lastResetDate !== today) {
    merged.correctedToday = 0;
    merged.lastResetDate = today;
    await chrome.storage.local.set({ stats: merged });
  }
  return merged;
}

export async function incrementStats(count: number): Promise<ExtensionStats> {
  const stats = await getStats();
  stats.correctedToday += count;
  stats.totalCorrections += count;
  await chrome.storage.local.set({ stats });
  return stats;
}

export async function resetStats(): Promise<ExtensionStats> {
  const fresh: ExtensionStats = {
    correctedToday: 0,
    totalCorrections: 0,
    lastResetDate: new Date().toISOString().slice(0, 10),
  };
  await chrome.storage.local.set({ stats: fresh });
  return fresh;
}
