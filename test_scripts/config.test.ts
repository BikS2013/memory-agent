import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config/config.js';

/**
 * Valid environment variables for a successful loadConfig() call.
 */
const VALID_ENV = {
  LLM_PROVIDER: 'openai',
  LLM_API_KEY: 'sk-test-key-12345',
  LLM_MODEL: 'gpt-4',
  DATABASE_PATH: '/tmp/test.db',
  WATCH_DIRECTORY: '/tmp/inbox',
  API_PORT: '3000',
  CONSOLIDATION_INTERVAL_MS: '60000',
};

const ENV_KEYS = Object.keys(VALID_ENV) as (keyof typeof VALID_ENV)[];

describe('loadConfig()', () => {
  // Save original env and restore after each test
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env values
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  /**
   * Helper: sets all valid env vars, then deletes the specified key.
   */
  function setAllExcept(exclude: string): void {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
    delete process.env[exclude];
  }

  /**
   * Helper: sets all valid env vars.
   */
  function setAll(): void {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
  }

  // --- Missing required environment variables ---

  it('throws when LLM_PROVIDER is missing', () => {
    setAllExcept('LLM_PROVIDER');
    expect(() => loadConfig()).toThrow('LLM_PROVIDER');
  });

  it('throws when LLM_API_KEY is missing', () => {
    setAllExcept('LLM_API_KEY');
    expect(() => loadConfig()).toThrow('LLM_API_KEY');
  });

  it('throws when LLM_MODEL is missing', () => {
    setAllExcept('LLM_MODEL');
    expect(() => loadConfig()).toThrow('LLM_MODEL');
  });

  it('throws when DATABASE_PATH is missing', () => {
    setAllExcept('DATABASE_PATH');
    expect(() => loadConfig()).toThrow('DATABASE_PATH');
  });

  it('throws when WATCH_DIRECTORY is missing', () => {
    setAllExcept('WATCH_DIRECTORY');
    expect(() => loadConfig()).toThrow('WATCH_DIRECTORY');
  });

  it('throws when API_PORT is missing', () => {
    setAllExcept('API_PORT');
    expect(() => loadConfig()).toThrow('API_PORT');
  });

  it('throws when CONSOLIDATION_INTERVAL_MS is missing', () => {
    setAllExcept('CONSOLIDATION_INTERVAL_MS');
    expect(() => loadConfig()).toThrow('CONSOLIDATION_INTERVAL_MS');
  });

  // --- Invalid values ---

  it('throws for invalid LLM_PROVIDER value', () => {
    setAll();
    process.env['LLM_PROVIDER'] = 'invalid-provider';
    expect(() => loadConfig()).toThrow('Invalid LLM_PROVIDER');
  });

  it('throws for non-numeric API_PORT', () => {
    setAll();
    process.env['API_PORT'] = 'not-a-number';
    expect(() => loadConfig()).toThrow('API_PORT');
  });

  // --- Successful load ---

  it('succeeds with all valid environment variables', () => {
    setAll();
    const config = loadConfig();

    expect(config.llmProvider).toBe('openai');
    expect(config.llmApiKey).toBe('sk-test-key-12345');
    expect(config.llmModel).toBe('gpt-4');
    expect(config.databasePath).toBe('/tmp/test.db');
    expect(config.watchDirectory).toBe('/tmp/inbox');
    expect(config.apiPort).toBe(3000);
    expect(config.consolidationIntervalMs).toBe(60000);
  });
});
