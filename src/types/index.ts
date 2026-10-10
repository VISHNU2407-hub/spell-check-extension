export type Sensitivity = 'conservative' | 'balanced' | 'aggressive';

export type CorrectionMode = 'automatic' | 'click' | 'both';

export interface ExtensionSettings {
  extensionEnabled: boolean;
  autoCorrectEnabled: boolean;
  aiEnabled: boolean;
  offlineEnabled: boolean;
  sensitivity: Sensitivity;
  debounceMs: number;
  language: string;
  model: string;
  excludedSites: string[];
  /** Local proxy backend URL (GROQ_API_KEY lives server-side, never in the extension). */
  backendUrl: string;
  /** True when the user manually switched AI off — blocks proxy auto-enable. */
  aiUserDisabled: boolean;
  /** Development-mode console logging (metadata only, never text or keys). */
  debugLogging: boolean;
  /** Show the floating ✨ AI correction button near the active field. */
  showAiButton: boolean;
  /**
   * automatic: correct while typing. click: only via ✨ button (no auto
   * replacement). both: automatic + button.
   */
  correctionMode: CorrectionMode;
}

export interface ExtensionStats {
  correctedToday: number;
  totalCorrections: number;
  lastResetDate: string; // YYYY-MM-DD
}

export interface StoredData extends ExtensionSettings {
  stats: ExtensionStats;
}

export const DEFAULT_MODEL = 'openai/gpt-oss-20b';

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

export const SUPPORTED_MODELS: string[] = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'moonshotai/kimi-k2-instruct-0905'
];

/** Models decommissioned by Groq — auto-migrated to DEFAULT_MODEL on load. */
export const RETIRED_MODELS: string[] = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  extensionEnabled: true,
  autoCorrectEnabled: true,
  aiEnabled: false, // OFF by default for privacy
  offlineEnabled: true,
  sensitivity: 'balanced',
  debounceMs: 900,
  language: 'en',
  model: DEFAULT_MODEL,
  excludedSites: ['github.com', 'stackoverflow.com'],
  backendUrl: DEFAULT_BACKEND_URL,
  aiUserDisabled: false,
  debugLogging: true,
  showAiButton: true,
  correctionMode: 'click'
};

export const DEFAULT_STATS: ExtensionStats = {
  correctedToday: 0,
  totalCorrections: 0,
  lastResetDate: new Date().toISOString().slice(0, 10)
};

export type MessageType =
  | { type: 'AI_CORRECT'; text: string; requestId: string }
  | { type: 'TEST_CONNECTION' }
  | { type: 'SETTINGS_UPDATED' };

export interface AICorrectResponse {
  ok: boolean;
  corrected?: string;
  error?: string;
}
