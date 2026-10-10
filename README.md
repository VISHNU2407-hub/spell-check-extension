# AutoCorrect AI

Real-time spelling autocorrect for Chrome. Offline dictionary engine fixes common
mistakes instantly as you type; optional Groq AI pass handles context-aware
corrections after a short typing pause.

## Features

- **Instant offline correction** — dictionary + edit-distance engine, no network needed.
- **Word-boundary correction** — corrects finished words (space/punctuation), never mid-word fragments.
- **Groq AI context pass** (OFF by default) — debounced, cached, stale-response protected, safety-validated before applying.
- **Safe text replacement** — preserves cursor/selection; React-compatible input setters; careful contenteditable handling.
- **Privacy-first** — skips password/payment/OTP/code-editor fields; only eligible text sent to Groq; minimal MV3 permissions.
- **✨ Floating AI button** — Shadow-DOM overlay beside the active field; click to correct via Groq (spinner → green check / error states, tooltips, offline fallback, stale protection).
- **Correction modes** — Automatic (while typing), Click to Correct (✨ only, default), Both.
- **Popup + Options UI** — toggles, API key config, model selector, sensitivity, debounce, exclusions, stats.

## Using the ✨ floating button

1. Click any text field and type — the ✨ button appears at its right edge.
2. Click ✨ (a real mouse click works; the button never submits forms).
3. Spinner shows "Correcting...", then a green check with "Corrected!"
   (or "Looks good!" if nothing needed, "Correction failed" if Groq is
   unreachable — your text is always kept).
4. Change **Correction mode** in the popup or Settings:
   - **Click to Correct** (default): nothing changes until you click ✨.
   - **Automatic**: corrections happen while typing (original behavior).
   - **Both**: automatic correction plus the ✨ button.

## Project structure

```
public/manifest.json        Manifest V3
src/background/             Service worker (Groq calls, stats)
src/content/                detector, text-replacer, content wiring
src/correction/             dictionary, wordlist, local-spellcheck, ai-correction, correction-manager
src/popup/                  Popup UI
src/options/                Settings page
src/utils/                  storage, helpers
src/types/                  Shared types
scripts/build.mjs           esbuild bundling + static copy
tests/                      node:test automated tests
```

## Build

Requires Node.js 18+.

```bash
npm install
npm run build
```

Output goes to `dist/`.

## Install in Chrome

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. The AutoCorrect AI icon appears in the toolbar

## Configure Groq AI (automatic via local proxy — recommended)

Chrome extensions cannot hide bundled API keys, so the extension talks to a
tiny local proxy (`backend/server.mjs`) that holds the key server-side.

1. Put your key in `.env` at the project root (already git-ignored):
   ```bash
   GROQ_API_KEY=your-key-here
   ```
2. Start the proxy (leave it running):
   ```bash
   npm run backend
   # or double-click backend\start-backend.bat
   ```
3. Load the extension from `dist/` and browse — on startup it detects the
   proxy and **auto-enables AI correction**. No manual key entry needed.
4. Verify: extension popup → **Test connection** → `Connected ✓ via proxy`.

Fallback (no proxy): paste a key in the popup → direct Groq mode.

> Security note: keys in `chrome.storage.local` live on your device and are
> readable by extension code — they cannot be fully protected client-side. Do
> not ship a shared key in a public build; use a backend proxy instead.
> The proxy binds to 127.0.0.1 only and never logs keys or message text.

## Test

```bash
npm test
```

Manual checks: type `helo`, `recieve`, `i wnat to lern python` in any textarea
(e.g. Google Search, Gmail compose). With AI on, try `their going home`.

Offline-only checks (no key needed): Tests 1–7 in `tests/correction.test.mjs`.

## Troubleshooting

- **Nothing corrects**: check master Extension + Auto-correction toggles, and that the site isn't in exclusions.
- **AI not working**: start the proxy (`npm run backend`), check popup status line;
  local correction keeps working as fallback. "Proxy has no key" → check `.env`.
- **AI turned itself on?**: the proxy auto-enables AI on startup. Switch AI OFF
  in the popup to opt out permanently (persists across restarts).
- **GitHub/StackOverflow skipped**: excluded by default (code-heavy sites) — remove in Settings → Excluded websites.
- **Password/card fields untouched**: by design, never corrected.

## Known limitations

- Rich editors (Google Docs canvas, some ProseMirror/Lexical builds) may be skipped when safe replacement can't be guaranteed.
- Undo is preserved per keystroke batch by the browser, but a correction + continued typing is one undo step on some sites.
- IME/composition input pauses correction until composition ends.
- AI model availability depends on Groq; if a model is retired, pick another in the popup.
