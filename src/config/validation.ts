import type { AppConfig } from './types.js';
import { VALID_LLM_PROVIDERS } from './types.js';

/**
 * Validates the loaded configuration object.
 * Throws on any invalid value. No defaults. No fallbacks.
 *
 * @param config - The loaded AppConfig to validate
 * @throws Error with a descriptive message for each validation failure
 */
export function validateConfig(config: AppConfig): void {
  // Validate LLM provider
  if (!VALID_LLM_PROVIDERS.includes(config.llmProvider)) {
    throw new Error(
      `Invalid LLM_PROVIDER: "${config.llmProvider}". ` +
      `Must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`
    );
  }

  // Validate llmModel is non-empty
  if (typeof config.llmModel !== 'string' || config.llmModel.trim() === '') {
    throw new Error(
      'Invalid LLM_MODEL: must be a non-empty string.'
    );
  }

  // Validate llmApiKey is non-empty
  if (typeof config.llmApiKey !== 'string' || config.llmApiKey.trim() === '') {
    throw new Error(
      'Invalid LLM_API_KEY: must be a non-empty string.'
    );
  }

  // Validate databasePath is non-empty
  if (typeof config.databasePath !== 'string' || config.databasePath.trim() === '') {
    throw new Error(
      'Invalid DATABASE_PATH: must be a non-empty string.'
    );
  }

  // Validate watchDirectory is non-empty
  if (typeof config.watchDirectory !== 'string' || config.watchDirectory.trim() === '') {
    throw new Error(
      'Invalid WATCH_DIRECTORY: must be a non-empty string.'
    );
  }

  // Validate API port is a positive integer in valid range
  if (!Number.isInteger(config.apiPort) || config.apiPort < 1 || config.apiPort > 65535) {
    throw new Error(
      `Invalid API_PORT: ${config.apiPort}. ` +
      `Must be a positive integer between 1 and 65535.`
    );
  }

  // Validate consolidation interval is a positive integer >= 1000
  if (!Number.isInteger(config.consolidationIntervalMs) || config.consolidationIntervalMs < 1000) {
    throw new Error(
      `Invalid CONSOLIDATION_INTERVAL_MS: ${config.consolidationIntervalMs}. ` +
      `Must be a positive integer of at least 1000 (1 second).`
    );
  }
}
