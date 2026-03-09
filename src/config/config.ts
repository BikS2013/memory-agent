import type { AppConfig } from './types.js';
import { validateConfig } from './validation.js';

/**
 * Loads application configuration from environment variables.
 * Throws an Error for any missing or invalid configuration parameter.
 * No defaults. No fallbacks.
 *
 * @returns Validated AppConfig
 * @throws Error with a clear message naming the missing/invalid variable
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    llmProvider: getRequiredEnv('LLM_PROVIDER') as AppConfig['llmProvider'],
    llmModel: getRequiredEnv('LLM_MODEL'),
    llmApiKey: getRequiredEnv('LLM_API_KEY'),
    databasePath: getRequiredEnv('DATABASE_PATH'),
    watchDirectory: getRequiredEnv('WATCH_DIRECTORY'),
    apiPort: parseRequiredInt('API_PORT'),
    consolidationIntervalMs: parseRequiredInt('CONSOLIDATION_INTERVAL_MS'),
  };

  validateConfig(config);
  return config;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Set it before starting the application.`
    );
  }
  return value.trim();
}

function parseRequiredInt(name: string): number {
  const raw = getRequiredEnv(name);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Invalid value for environment variable ${name}: "${raw}". ` +
      `Expected an integer.`
    );
  }
  return parsed;
}
