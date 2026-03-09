import { loadYamlFile } from './yaml-loader.js';
import { storageConfigSchema } from './storage-config-schema.js';
import { llmConfigSchema } from './llm-config-schema.js';
import type { AppConfig } from './types.js';

/**
 * Loads application configuration from YAML files and environment variables.
 * Throws an Error for any missing or invalid configuration parameter.
 * No defaults. No fallbacks.
 *
 * @returns Validated AppConfig
 * @throws Error with a clear message naming the missing/invalid variable
 */
export function loadConfig(): AppConfig {
  // 1. Read mandatory env var paths
  const storageConfigPath = process.env.STORAGE_CONFIG_PATH;
  if (!storageConfigPath) {
    throw new Error(
      'Environment variable STORAGE_CONFIG_PATH is not set. ' +
        'It must contain the absolute path to storage-config.yaml.'
    );
  }

  const llmConfigPath = process.env.LLM_CONFIG_PATH;
  if (!llmConfigPath) {
    throw new Error(
      'Environment variable LLM_CONFIG_PATH is not set. ' +
        'It must contain the absolute path to llm-config.yaml.'
    );
  }

  // 2. Load and validate YAML files
  const rawStorage = loadYamlFile(storageConfigPath);
  const storageResult = storageConfigSchema.safeParse(rawStorage);
  if (!storageResult.success) {
    throw new Error(
      `Invalid storage-config.yaml at ${storageConfigPath}:\n` +
        storageResult.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }

  const rawLlm = loadYamlFile(llmConfigPath);
  const llmResult = llmConfigSchema.safeParse(rawLlm);
  if (!llmResult.success) {
    throw new Error(
      `Invalid llm-config.yaml at ${llmConfigPath}:\n` +
        llmResult.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }

  // 3. Read remaining env vars (no fallbacks)
  const watchDirectory = process.env.WATCH_DIRECTORY;
  if (!watchDirectory) {
    throw new Error('Environment variable WATCH_DIRECTORY is not set.');
  }

  const apiPortStr = process.env.API_PORT;
  if (!apiPortStr) {
    throw new Error('Environment variable API_PORT is not set.');
  }
  const apiPort = parseInt(apiPortStr, 10);
  if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error(
      `API_PORT must be an integer between 1 and 65535. Got: "${apiPortStr}"`
    );
  }

  const intervalStr = process.env.CONSOLIDATION_INTERVAL_MS;
  if (!intervalStr) {
    throw new Error(
      'Environment variable CONSOLIDATION_INTERVAL_MS is not set.'
    );
  }
  const consolidationIntervalMs = parseInt(intervalStr, 10);
  if (isNaN(consolidationIntervalMs) || consolidationIntervalMs < 1000) {
    throw new Error(
      `CONSOLIDATION_INTERVAL_MS must be an integer >= 1000. Got: "${intervalStr}"`
    );
  }

  // 4. Assemble and return
  return {
    storage: storageResult.data.storage,
    llm: llmResult.data.llm,
    watchDirectory,
    apiPort,
    consolidationIntervalMs,
  };
}
