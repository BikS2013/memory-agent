/**
 * Supported LLM provider identifiers.
 */
export type LlmProvider = 'openai' | 'anthropic' | 'google';

/**
 * Array of all valid LLM provider values, used for runtime validation.
 */
export const VALID_LLM_PROVIDERS: readonly LlmProvider[] = [
  'openai',
  'anthropic',
  'google',
] as const;

/**
 * Application configuration.
 * All fields are required. No defaults. No fallbacks.
 * Missing any parameter causes an exception at startup.
 */
export interface AppConfig {
  /** LLM provider identifier: "openai", "anthropic", or "google" */
  readonly llmProvider: LlmProvider;
  /** Model identifier (e.g., "gpt-4", "claude-sonnet-4-20250514", "gemini-2.0-flash") */
  readonly llmModel: string;
  /** API key for the selected LLM provider */
  readonly llmApiKey: string;
  /** Path to SQLite database file */
  readonly databasePath: string;
  /** Path to inbox directory for file watching */
  readonly watchDirectory: string;
  /** HTTP server port number (1-65535) */
  readonly apiPort: number;
  /** Consolidation loop interval in milliseconds (>= 1000) */
  readonly consolidationIntervalMs: number;
}
