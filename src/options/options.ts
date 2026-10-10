import { getSettings, setSettings, getApiKey, setApiKey, getStats, resetStats } from '../utils/storage.js';
import { SUPPORTED_MODELS } from '../types/index.js';
import { clamp } from '../utils/helpers.js';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved(): void {
  const el = $('saved');
  el.classList.add('show');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

async function refresh(): Promise<void> {
  const [s, key, stats] = await Promise.all([getSettings(), getApiKey(), getStats()]);
  ( $('extensionEnabled') as HTMLInputElement ).checked = s.extensionEnabled;
  ( $('autoCorrectEnabled') as HTMLInputElement ).checked = s.autoCorrectEnabled;
  ( $('offlineEnabled') as HTMLInputElement ).checked = s.offlineEnabled;
  ( $('aiEnabled') as HTMLInputElement ).checked = s.aiEnabled;
  ( $('showAiButton') as HTMLInputElement ).checked = s.showAiButton !== false;
  ( $('correctionMode') as HTMLSelectElement ).value = s.correctionMode;
  ( $('debugLogging') as HTMLInputElement ).checked = s.debugLogging !== false;
  ( $('sensitivity') as HTMLSelectElement ).value = s.sensitivity;
  ( $('language') as HTMLSelectElement ).value = s.language;
  ( $('debounceMs') as HTMLInputElement ).value = String(s.debounceMs);
  ( $('apiKey') as HTMLInputElement ).value = key;
  ( $('backendUrl') as HTMLInputElement ).value = s.backendUrl;
  ( $('excludedSites') as HTMLTextAreaElement ).value = (s.excludedSites ?? []).join('\n');
  $('todayCount').textContent = String(stats.correctedToday);
  $('totalCount').textContent = String(stats.totalCorrections);
  void refreshProxyStatus();

  const modelSel = $('model') as HTMLSelectElement;
  modelSel.innerHTML = '';
  for (const m of Array.from(new Set([...SUPPORTED_MODELS, s.model]))) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === s.model) opt.selected = true;
    modelSel.appendChild(opt);
  }
}

function setStatus(msg: string, kind: string): void {
  const el = $('connStatus');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

async function refreshProxyStatus(): Promise<void> {
  const el = $('proxyStatus');
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' })) as {
      ok: boolean;
      via: string;
      proxyUp: boolean;
      backendUrl: string;
    };
    if (res?.ok && res.via === 'proxy') {
      el.textContent = `Local proxy connected (${res.backendUrl}) — AI is auto-configured.`;
      el.className = 'status ok';
    } else if (res?.ok && res.via === 'direct') {
      el.textContent = 'Proxy offline — using the key saved below (direct mode).';
      el.className = 'status';
    } else {
      el.textContent = 'Proxy offline — start it with: npm run backend';
      el.className = 'status';
    }
  } catch {
    el.textContent = '';
    el.className = 'status';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void refresh();
  const bind = (id: string, key: string) => {
    $(id).addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      void setSettings({ [key]: checked } as never).then(flashSaved);
    });
  };
  bind('extensionEnabled', 'extensionEnabled');
  bind('autoCorrectEnabled', 'autoCorrectEnabled');
  bind('offlineEnabled', 'offlineEnabled');
  bind('aiEnabled', 'aiEnabled');
  bind('showAiButton', 'showAiButton');
  bind('debugLogging', 'debugLogging');
  $('correctionMode').addEventListener('change', (e) => {
    void setSettings({
      correctionMode: (e.target as HTMLSelectElement).value as 'automatic' | 'click' | 'both',
    }).then(flashSaved);
  });
  $('aiEnabled').addEventListener('change', (e) => {
    // Manual OFF opts out of proxy auto-enable; manual ON clears the opt-out.
    const on = (e.target as HTMLInputElement).checked;
    void setSettings({ aiUserDisabled: !on }).then(flashSaved);
  });
  $('backendUrl').addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value.trim() || 'http://127.0.0.1:8787';
    (e.target as HTMLInputElement).value = v;
    void setSettings({ backendUrl: v }).then(() => {
      flashSaved();
      void refreshProxyStatus();
    });
  });

  $('sensitivity').addEventListener('change', (e) => {
    void setSettings({ sensitivity: (e.target as HTMLSelectElement).value as never }).then(flashSaved);
  });
  $('model').addEventListener('change', (e) => {
    void setSettings({ model: (e.target as HTMLSelectElement).value }).then(flashSaved);
  });
  $('debounceMs').addEventListener('change', (e) => {
    const v = clamp(parseInt((e.target as HTMLInputElement).value, 10) || 900, 300, 5000);
    (e.target as HTMLInputElement).value = String(v);
    void setSettings({ debounceMs: v }).then(flashSaved);
  });
  $('excludedSites').addEventListener('change', (e) => {
    const list = (e.target as HTMLTextAreaElement).value
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    void setSettings({ excludedSites: list }).then(flashSaved);
  });
  $('saveKey').addEventListener('click', async () => {
    await setApiKey(($('apiKey') as HTMLInputElement).value.trim());
    setStatus('API key saved locally on this device.', 'ok');
    flashSaved();
  });
  $('testConn').addEventListener('click', async () => {
    setStatus('Testing…', '');
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' })) as {
        ok: boolean;
        error?: string;
        via?: string;
      };
      setStatus(
        res?.ok ? `Connected ✓ via ${res.via ?? 'unknown'}` : `Failed: ${res?.error ?? 'unknown'}`,
        res?.ok ? 'ok' : 'err'
      );
      void refreshProxyStatus();
    } catch {
      setStatus('Failed: background worker unreachable', 'err');
    }
  });
  $('resetStats').addEventListener('click', async () => {
    await resetStats();
    void refresh();
    flashSaved();
  });
});
