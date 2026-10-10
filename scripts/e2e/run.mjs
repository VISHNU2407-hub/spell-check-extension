/**
 * Real-browser e2e test for AutoCorrect AI.
 *
 * Loads the built extension (dist/) into Chromium via Puppeteer and verifies:
 * A. Automatic correction (textarea / input / contenteditable / AI pass).
 * B. Floating ✨ button: all 14 spec cases (visibility, click-to-correct,
 *    stale protection, scroll following, no form submit, click-only mode).
 *
 * Usage: npm run e2e
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startTestPageServer } from './testpage.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'dist');
const PAGE_PORT = 8901;
const results = [];
let browser = null;
let backendProc = null;
let page = null;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fn();
      if (last !== null && last !== undefined) return last;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for: ${label} (last=${JSON.stringify(last)})`);
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const res = await fetch('http://127.0.0.1:8787/api/health');
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('proxy backend never became healthy');
}

function startBackend() {
  backendProc = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    cwd: root,
    stdio: 'ignore',
  });
}

function stopBackend() {
  try {
    backendProc?.kill();
  } catch {
    /* ignore */
  }
  backendProc = null;
}

async function workerHandle() {
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker', {
    timeout: 15000,
  });
  const worker = await target.worker();
  if (!worker) throw new Error('no service worker handle');
  return worker;
}

async function getStorage() {
  return (await workerHandle()).evaluate(() => chrome.storage.local.get(null));
}

async function setStorage(patch) {
  await (await workerHandle()).evaluate((p) => chrome.storage.local.set(p), patch);
}

// ---- floating-button helpers (main world; host is light-DOM) ----
const btnVisible = () =>
  page.evaluate(() => {
    const h = document.getElementById('autocorrect-ai-btn-host');
    return h && h.style.display !== 'none' && h.dataset.visible === '1' ? 'yes' : null;
  });

const btnHidden = () =>
  page.evaluate(() => {
    const h = document.getElementById('autocorrect-ai-btn-host');
    return !h || h.style.display === 'none' || h.dataset.visible !== '1' ? 'yes' : null;
  });

const clickAiButton = () =>
  page.evaluate(() => {
    const h = document.getElementById('autocorrect-ai-btn-host');
    h.shadowRoot.querySelector('.acai-btn').click();
  });

const btnState = () =>
  page.evaluate(() => {
    const h = document.getElementById('autocorrect-ai-btn-host');
    const b = h?.shadowRoot.querySelector('.acai-btn');
    const t = h?.shadowRoot.querySelector('.acai-tip');
    return b ? `${b.dataset.state}|${t.textContent}` : null;
  });

async function clearAndType(selector, text) {
  await page.$eval(selector, (el) => {
    el.value = '';
  });
  await focusField(selector);
  await page.keyboard.type(text);
}

// Focus via evaluate (no trusted-mouse polling): exercises the same
// focusin/input code paths as a real click, without Puppeteer's
// scroll-stability polling which stalls on busy desktops.
async function focusField(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el && el.scrollIntoView) {
      try {
        el.scrollIntoView({ block: 'nearest' });
      } catch {
        /* ignore */
      }
    }
    if (el && el.focus) el.focus();
  }, selector);
}

// One genuine trusted-input mouse click (used for the ✨ button itself).
async function mouseClickCenter(selector) {
  const pt = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.click(pt.x, pt.y);
}

// Real mouse click on the actual ✨ button (pierces open shadow DOM for coords).
async function mouseClickAiButton() {
  const pt = await page.evaluate(() => {
    const h = document.getElementById('autocorrect-ai-btn-host');
    const r = h.shadowRoot.querySelector('.acai-btn').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
}

async function main() {
  // Preflight: kill stale proxy backends from killed runs (they hold :8787).
  try {
    const { execSync } = await import('node:child_process');
    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \'Name=\'\'node.exe\'\'\' | Where-Object { $_.CommandLine -match \'backend/server.mjs\' } | Select-Object -ExpandProperty ProcessId"',
        { encoding: 'utf8', timeout: 15000 }
      );
      for (const pid of out.split(/\s+/).map(Number).filter((n) => n > 0 && n !== process.pid)) {
        try {
          process.kill(pid, 'SIGKILL');
          console.log(`[e2e] killed stale backend pid=${pid}`);
        } catch {
          /* ignore */
        }
      }
    } else {
      try {
        execSync('pkill -f "backend/server.mjs"', { stdio: 'ignore', timeout: 15000 });
      } catch {
        /* none stale */
      }
    }
  } catch {
    /* preflight best-effort */
  }

  const pageServer = await startTestPageServer(PAGE_PORT);
  console.log(`[e2e] test page: http://127.0.0.1:${PAGE_PORT}/test.html`);

  startBackend();
  const health = await waitForHealth();
  check('proxy backend healthy', health?.ok === true, JSON.stringify(health));

  const profile = mkdtempSync(join(tmpdir(), 'aca-e2e-'));
  try {
    browser = await puppeteer.launch({
      headless: false,
      protocolTimeout: 60000,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      userDataDir: profile,
    });
  } catch (err) {
    check('launch headed chromium', false, String(err?.message ?? err).slice(0, 200));
    throw err;
  }
  check('launch headed chromium with extension', true);

  page = await browser.newPage();
  const extLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[AutoCorrect AI]')) extLogs.push(text);
  });
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/test.html`);

  try {
    await waitFor(
      () =>
        page.evaluate(() =>
          document.documentElement.dataset.autocorrectAi ? 'yes' : null
        ),
      15000,
      'content script marker'
    );
    check('content script loads on page', true);
  } catch (err) {
    check('content script loads on page', false, String(err.message).slice(0, 160));
  }

  try {
    const stored = await waitFor(async () => {
      const s = await getStorage();
      return s && s.aiEnabled === true ? s : null;
    }, 15000, 'aiEnabled auto-set');
    check('AI auto-enabled via proxy', stored.aiEnabled === true);
  } catch (err) {
    check('AI auto-enabled via proxy', false, String(err.message).slice(0, 160));
    await setStorage({ aiEnabled: true, aiUserDisabled: false });
  }

  // ---- Section A: automatic mode (existing behavior) ----
  await setStorage({
    correctionMode: 'automatic',
    aiEnabled: true,
    aiUserDisabled: false,
    debounceMs: 500,
  });
  await new Promise((r) => setTimeout(r, 500));

  try {
    await focusField('#ta');
    await page.keyboard.type('helo ');
    const val = await waitFor(async () => {
      const v = await page.$eval('#ta', (el) => el.value);
      return v === 'hello ' ? v : null;
    }, 8000, 'textarea correction');
    check('textarea: "helo " -> "hello "', val === 'hello ', JSON.stringify(val));
  } catch {
    const v = await page.$eval('#ta', (el) => el.value).catch(() => '?');
    check('textarea: "helo " -> "hello "', false, `got ${JSON.stringify(v)}`);
  }

  try {
    await focusField('#in');
    await page.keyboard.type('recieve ');
    const val = await waitFor(async () => {
      const v = await page.$eval('#in', (el) => el.value);
      return v === 'receive ' ? v : null;
    }, 8000, 'input correction');
    check('input: "recieve " -> "receive "', val === 'receive ', JSON.stringify(val));
  } catch {
    const v = await page.$eval('#in', (el) => el.value).catch(() => '?');
    check('input: "recieve " -> "receive "', false, `got ${JSON.stringify(v)}`);
  }

  try {
    await focusField('#ce');
    await page.keyboard.type('teh ');
    const val = await waitFor(async () => {
      const v = await page.$eval('#ce', (el) => el.innerText);
      return v.trim() === 'the' ? v : null;
    }, 8000, 'contenteditable correction');
    check('contenteditable: "teh " -> "the "', true, JSON.stringify(val));
  } catch {
    const v = await page.$eval('#ce', (el) => el.innerText).catch(() => '?');
    check('contenteditable: "teh " -> "the "', false, `got ${JSON.stringify(v)}`);
  }

  try {
    await focusField('#ai');
    await page.keyboard.type('ths is a tset');
    const val = await waitFor(async () => {
      const v = await page.$eval('#ai', (el) => el.value);
      return v === 'this is a test' ? v : null;
    }, 30000, 'AI correction');
    check('AI: "ths is a tset" -> "this is a test"', val === 'this is a test', JSON.stringify(val));
  } catch {
    const v = await page.$eval('#ai', (el) => el.value).catch(() => '?');
    check('AI: "ths is a tset" -> "this is a test"', false, `got ${JSON.stringify(v)}`);
  }

  // ---- Section B: floating button, Click-to-Correct mode ----
  await setStorage({ correctionMode: 'click', showAiButton: true });
  await new Promise((r) => setTimeout(r, 500));

  // B1: focus textarea -> icon appears; B2: type -> remains visible.
  try {
    await clearAndType('#btn', 'helo how ar yu');
    await waitFor(btnVisible, 5000, 'button visible');
    check('B1+B2 focus+type textarea -> icon visible', true);
  } catch (err) {
    check('B1+B2 focus+type textarea -> icon visible', false, String(err.message).slice(0, 120));
  }

  // B14 first half: click mode must NOT auto-replace typed text.
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const v = await page.$eval('#btn', (el) => el.value);
    check('B14 click mode: no automatic replacement', v === 'helo how ar yu', JSON.stringify(v));
  } catch (err) {
    check('B14 click mode: no automatic replacement', false, String(err.message).slice(0, 120));
  }

  // B3: click icon -> corrected (genuine trusted mouse click on the button).
  try {
    await mouseClickAiButton();
    const val = await waitFor(async () => {
      const v = await page.$eval('#btn', (el) => el.value);
      return v === 'hello how are you' ? v : null;
    }, 30000, 'button click correction');
    check('B3 click ✨ -> "hello how are you"', val === 'hello how are you', JSON.stringify(val));
  } catch {
    const v = await page.$eval('#btn', (el) => el.value).catch(() => '?');
    check('B3 click ✨ -> "hello how are you"', false, `got ${JSON.stringify(v)}`);
  }

  // B4: empty input -> icon hidden.
  try {
    await page.$eval('#btn', (el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(btnHidden, 5000, 'button hidden on empty');
    check('B4 empty input -> icon hidden', true);
  } catch (err) {
    check('B4 empty input -> icon hidden', false, String(err.message).slice(0, 120));
  }

  // B5: password field -> no icon.
  try {
    await focusField('#pwd');
    await page.keyboard.type('secret123');
    await new Promise((r) => setTimeout(r, 800));
    await waitFor(btnHidden, 3000, 'no button on password');
    check('B5 password field -> no icon', true);
  } catch (err) {
    check('B5 password field -> no icon', false, String(err.message).slice(0, 120));
  }

  // B6: disabled input -> no icon.
  try {
    await page.evaluate(() => document.getElementById('dis').focus());
    await new Promise((r) => setTimeout(r, 800));
    await waitFor(btnHidden, 3000, 'no button on disabled');
    check('B6 disabled input -> no icon', true);
  } catch (err) {
    check('B6 disabled input -> no icon', false, String(err.message).slice(0, 120));
  }

  // B7: search bar -> icon appears.
  try {
    await clearAndType('#search', 'helo world');
    await waitFor(btnVisible, 5000, 'button on search');
    check('B7 search bar -> icon appears', true);
  } catch (err) {
    check('B7 search bar -> icon appears', false, String(err.message).slice(0, 120));
  }

  // B8: contenteditable -> icon appears.
  try {
    await focusField('#ce2');
    await page.keyboard.type('helo ');
    await waitFor(btnVisible, 5000, 'button on contenteditable');
    check('B8 contenteditable -> icon appears', true);
  } catch (err) {
    check('B8 contenteditable -> icon appears', false, String(err.message).slice(0, 120));
  }

  // B11: multiple inputs -> icon follows active field.
  try {
    await clearAndType('#in', 'follow me');
    await waitFor(btnVisible, 5000, 'button follows');
    const near = await page.evaluate(() => {
      const h = document.getElementById('autocorrect-ai-btn-host');
      const f = document.getElementById('in');
      const hr = h.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      const hcx = hr.left + hr.width / 2;
      const hcy = hr.top + hr.height / 2;
      return Math.abs(hcx - fr.right) < 60 && hcy >= fr.top - 20 && hcy <= fr.bottom + 20
        ? 'yes'
        : null;
    });
    check('B11 icon follows active field', near === 'yes', near ?? 'mispositioned');
  } catch (err) {
    check('B11 icon follows active field', false, String(err.message).slice(0, 120));
  }

  // B12: scrolling -> icon stays positioned (mid-page field has room both ways).
  const posDetail = () =>
    page.evaluate(() => {
      const h = document.getElementById('autocorrect-ai-btn-host');
      const f = document.getElementById('mid');
      const hr = h.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      return `host=${hr.left},${hr.top} field=${fr.left},${fr.top},${fr.right},${fr.bottom} scrollY=${window.scrollY} vh=${window.innerHeight}`;
    });
  const nearField = (id) =>
    page.evaluate((fid) => {
      const h = document.getElementById('autocorrect-ai-btn-host');
      const f = document.getElementById(fid);
      const hr = h.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      const hcx = hr.left + hr.width / 2;
      const hcy = hr.top + hr.height / 2;
      return Math.abs(hcx - fr.right) < 60 && hcy >= fr.top - 20 && hcy <= fr.bottom + 20
        ? 'yes'
        : null;
    }, id);
  try {
    await clearAndType('#mid', 'scroll test here');
    await waitFor(btnVisible, 5000, 'button at mid field');
    // Center the field (clearAndType used minimal scrolling), then scroll a
    // small amount that keeps the field onscreen.
    await page.evaluate(() => document.getElementById('mid').scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 400));
    const before = await posDetail();
    await page.evaluate(() => window.scrollBy(0, -80));
    await new Promise((r) => setTimeout(r, 1000));
    const near = await nearField('mid');
    const scrolls = await page.evaluate(() => document.documentElement.dataset.acaiScrolls);
    check(
      'B12 scrolling keeps icon positioned',
      near === 'yes',
      near ?? `${await posDetail()} before: ${before} scrolls=${scrolls}`
    );
  } catch (err) {
    check('B12 scrolling keeps icon positioned', false, String(err.message).slice(0, 120));
  }

  // B13: clicking icon does not submit forms.
  try {
    await clearAndType('#formIn', 'helo form test');
    await waitFor(btnVisible, 5000, 'button in form field');
    await clickAiButton();
    await waitFor(async () => {
      const v = await page.$eval('#formIn', (el) => el.value);
      return v === 'hello form test' ? v : null;
    }, 30000, 'form field correction');
    const submitted = await page.evaluate(() => window.__formSubmitted);
    check('B13 click does not submit form', submitted !== true, `submitted=${submitted}`);
  } catch (err) {
    check('B13 click does not submit form', false, String(err.message).slice(0, 160));
  }

  // B10: text changed during AI request -> not overwritten (stale protection).
  // Deterministic: append text in the SAME JS task as the click, so the
  // async AI round-trip can never win the race.
  try {
    await clearAndType('#btn', 'ths is a tset');
    await waitFor(btnVisible, 5000, 'button for stale test');
    await page.evaluate(() => {
      const h = document.getElementById('autocorrect-ai-btn-host');
      h.shadowRoot.querySelector('.acai-btn').click();
      const ta = document.getElementById('btn');
      ta.focus();
      document.execCommand('insertText', false, ' zzz');
    });
    await new Promise((r) => setTimeout(r, 12000));
    const v = await page.$eval('#btn', (el) => el.value);
    const preserved = typeof v === 'string' && v.endsWith('zzz') && v.includes('ths is a tset');
    check('B10 stale response does not overwrite', preserved, JSON.stringify(v));
  } catch (err) {
    check('B10 stale response does not overwrite', false, String(err.message).slice(0, 160));
  }

  // B9: backend unavailable -> graceful error, text unchanged.
  try {
    stopBackend();
    await new Promise((r) => setTimeout(r, 1000));
    await clearAndType('#btn', 'their going home');
    await waitFor(btnVisible, 5000, 'button for offline test');
    await clickAiButton();
    const state = await waitFor(async () => {
      const s = await btnState();
      // Back to idle (stale-safe) or visible error tooltip; loading must end.
      if (s && !s.startsWith('loading')) return s;
      return null;
    }, 30000, 'button settles after backend failure');
    const v = await page.$eval('#btn', (el) => el.value);
    const graceful =
      v === 'their going home' &&
      (state.includes('Correction failed') || state.startsWith('idle'));
    check('B9 backend offline -> graceful, text kept', graceful, `${state} | ${JSON.stringify(v)}`);
  } catch (err) {
    check('B9 backend offline -> graceful, text kept', false, String(err.message).slice(0, 160));
  } finally {
    startBackend();
    await waitForHealth();
  }

  console.log('\n[e2e] ---- ai-button logs (all) ----');
  for (const l of extLogs.filter((x) => x.includes('ai-button'))) console.log('  ' + l);
  console.log('[e2e] --------------------------------\n');

  const failed = results.filter((r) => !r.ok);
  console.log(`[e2e] ${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  browser = null;
  pageServer.close();
  stopBackend();
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err?.message ?? err);
  try {
    stopBackend();
  } catch {
    /* ignore */
  }
  process.exit(2);
});
