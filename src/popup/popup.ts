import { getSettings, setSettings, getApiKey, setApiKey, getStats } from '../utils/storage.js';
import { SUPPORTED_MODELS } from '../types/index.js';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

interface AiStatus {
  ok: boolean;
  aiEnabled: boolean;
  via: 'proxy' | 'direct' | 'none';
  proxyUp: boolean;
  proxyHasKey: boolean;
  backendUrl: string;
}

async function getAiStatus(): Promise<AiStatus | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' })) as AiStatus;
    return res?.ok ? res : null;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const [settings, key, stats, aiStatus] = await Promise.all([
    getSettings(),
    getApiKey(),
    getStats(),
    getAiStatus(),
  ]);
  ( $('extensionEnabled') as HTMLInputElement ).checked = settings.extensionEnabled;
  ( $('autoCorrectEnabled') as HTMLInputElement ).checked = settings.autoCorrectEnabled;
  ( $('aiEnabled') as HTMLInputElement ).checked = settings.aiEnabled;
  ( $('showAiButton') as HTMLInputElement ).checked = settings.showAiButton !== false;
  ( $('correctionMode') as HTMLSelectElement ).value = settings.correctionMode;
  ( $('sensitivity') as HTMLSelectElement ).value = settings.sensitivity;
  ( $('apiKey') as HTMLInputElement ).value = key;
  $('todayCount').textContent = String(stats.correctedToday);
  $('totalCount').textContent = String(stats.totalCorrections);
  $('privacyNote').classList.toggle('hidden', settings.aiEnabled);

  const modelSel = $('model') as HTMLSelectElement;
  modelSel.innerHTML = '';
  const models = Array.from(new Set([...SUPPORTED_MODELS, settings.model]));
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === settings.model) opt.selected = true;
    modelSel.appendChild(opt);
  }
  updateBadge(!!key && settings.aiEnabled);
  void updateProxyLine(aiStatus, settings.aiEnabled);
}

async function updateProxyLine(aiStatus: AiStatus | null, aiEnabled: boolean): Promise<void> {
  const el = $('proxyStatus');
  if (!aiStatus) {
    el.textContent = '';
    el.className = 'status';
    return;
  }
  if (aiStatus.via === 'proxy') {
    el.textContent = `Local proxy connected (${aiStatus.backendUrl}) — AI auto-configured, no key needed.`;
    el.className = 'status ok';
  } else if (aiStatus.via === 'direct') {
    el.textContent = 'Using key saved in extension (direct Groq mode).';
    el.className = 'status ok';
  } else if (aiEnabled) {
    el.textContent = `AI on but no route: start the proxy (npm run backend) or save a key below.`;
    el.className = 'status err';
  } else {
    el.textContent = `Proxy offline. Start it with: npm run backend`;
    el.className = 'status';
  }
  // Badge reflects any working route.
  updateBadge(aiEnabled && aiStatus.via !== 'none');
}

function updateBadge(connected: boolean): void {
  const badge = $('connBadge');
  badge.textContent = connected ? 'Groq Ready' : 'Offline';
  badge.classList.toggle('connected', connected);
  badge.classList.toggle('disconnected', !connected);
}

function setStatus(msg: string, kind: 'ok' | 'err' | ''): void {
  const el = $('connStatus');
  el.textContent = msg;
  el.className = `status ${kind}`;
}

document.addEventListener('DOMContentLoaded', () => {
  void refresh();

  $('extensionEnabled').addEventListener('change', (e) => {
    void setSettings({ extensionEnabled: (e.target as HTMLInputElement).checked });
  });
  $('autoCorrectEnabled').addEventListener('change', (e) => {
    void setSettings({ autoCorrectEnabled: (e.target as HTMLInputElement).checked });
  });
  $('aiEnabled').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    // Manual OFF opts out of proxy auto-enable; manual ON clears the opt-out.
    void setSettings({ aiEnabled: on, aiUserDisabled: !on }).then(() => void refresh());
    if (on) {
      setStatus('AI enabled — eligible text will be sent to Groq.', 'ok');
    }
  });
  $('sensitivity').addEventListener('change', (e) => {
    void setSettings({ sensitivity: (e.target as HTMLSelectElement).value as 'conservative' | 'balanced' | 'aggressive' });
  });
  $('showAiButton').addEventListener('change', (e) => {
    void setSettings({ showAiButton: (e.target as HTMLInputElement).checked });
  });
  $('correctionMode').addEventListener('change', (e) => {
    void setSettings({
      correctionMode: (e.target as HTMLSelectElement).value as 'automatic' | 'click' | 'both',
    });
  });
  $('model').addEventListener('change', (e) => {
    void setSettings({ model: (e.target as HTMLSelectElement).value });
  });
  $('saveKey').addEventListener('click', async () => {
    const key = ($('apiKey') as HTMLInputElement).value.trim();
    await setApiKey(key);
    setStatus(key ? 'API key saved locally.' : 'API key cleared.', 'ok');
    void refresh();
  });
  $('toggleKey').addEventListener('click', () => {
    const input = $('apiKey') as HTMLInputElement;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('testConn').addEventListener('click', async () => {
    setStatus('Testing…', '');
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' })) as {
        ok: boolean;
        error?: string;
        sample?: string;
        via?: string;
      };
      if (res?.ok) {
        setStatus(`Connected ✓ via ${res.via ?? 'unknown'} (sample: "${(res.sample ?? '').slice(0, 40)}")`, 'ok');
        updateBadge(true);
      } else {
        setStatus(`Failed: ${res?.error ?? 'unknown error'}`, 'err');
        updateBadge(false);
      }
    } catch {
      setStatus('Failed: background worker unreachable', 'err');
      updateBadge(false);
    }
  });
  $('openOptions').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
});
