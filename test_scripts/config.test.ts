import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { loadConfig } from '../src/config/config.js';
import { parseStorageConfig } from '../src/config/storage-config-schema.js';
import { parseLlmConfig } from '../src/config/llm-config-schema.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const VALID_STORAGE_PATH = path.join(FIXTURES_DIR, 'storage-config-sqlite.yaml');
const VALID_LLM_PATH = path.join(FIXTURES_DIR, 'llm-config-openai.yaml');
const INVALID_STORAGE_PATH = path.join(FIXTURES_DIR, 'storage-config-invalid.yaml');
const INVALID_LLM_PATH = path.join(FIXTURES_DIR, 'llm-config-invalid.yaml');
const NON_EXISTENT_PATH = path.join(FIXTURES_DIR, 'does-not-exist.yaml');

/**
 * Environment variable keys managed by these tests.
 */
const ENV_KEYS = [
  'STORAGE_CONFIG_PATH',
  'LLM_CONFIG_PATH',
  'WATCH_DIRECTORY',
  'API_PORT',
  'CONSOLIDATION_INTERVAL_MS',
] as const;

/**
 * Valid environment variables for a successful loadConfig() call.
 */
const VALID_ENV: Record<string, string> = {
  STORAGE_CONFIG_PATH: VALID_STORAGE_PATH,
  LLM_CONFIG_PATH: VALID_LLM_PATH,
  WATCH_DIRECTORY: '/tmp/inbox',
  API_PORT: '3000',
  CONSOLIDATION_INTERVAL_MS: '60000',
};

describe('loadConfig()', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  /**
   * Helper: sets all valid env vars.
   */
  function setAll(): void {
    for (const [key, value] of Object.entries(VALID_ENV)) {
      process.env[key] = value;
    }
  }

  /**
   * Helper: sets all valid env vars, then deletes the specified key.
   */
  function setAllExcept(exclude: string): void {
    setAll();
    delete process.env[exclude];
  }

  // --- Successful load ---

  it('succeeds with valid YAML paths and env vars', () => {
    setAll();
    const config = loadConfig();

    expect(config.storage.provider).toBe('sqlite');
    expect(config.storage.sqlite).toBeDefined();
    expect(config.storage.sqlite!.databasePath).toBe(':memory:');
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('gpt-4');
    expect(config.llm.temperature).toBe(0.7);
    expect(config.llm.openai).toBeDefined();
    expect(config.llm.openai!.apiKey).toBe('sk-test-key-12345');
    expect(config.watchDirectory).toBe('/tmp/inbox');
    expect(config.apiPort).toBe(3000);
    expect(config.consolidationIntervalMs).toBe(60000);
  });

  // --- Missing environment variables ---

  it('throws when STORAGE_CONFIG_PATH env var is missing', () => {
    setAllExcept('STORAGE_CONFIG_PATH');
    expect(() => loadConfig()).toThrow('STORAGE_CONFIG_PATH');
  });

  it('throws when LLM_CONFIG_PATH env var is missing', () => {
    setAllExcept('LLM_CONFIG_PATH');
    expect(() => loadConfig()).toThrow('LLM_CONFIG_PATH');
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

  // --- YAML file does not exist ---

  it('throws when storage YAML file does not exist', () => {
    setAll();
    process.env['STORAGE_CONFIG_PATH'] = NON_EXISTENT_PATH;
    expect(() => loadConfig()).toThrow('not found');
  });

  it('throws when LLM YAML file does not exist', () => {
    setAll();
    process.env['LLM_CONFIG_PATH'] = NON_EXISTENT_PATH;
    expect(() => loadConfig()).toThrow('not found');
  });

  // --- Invalid YAML content ---

  it('throws when storage YAML has invalid content (missing provider section)', () => {
    setAll();
    process.env['STORAGE_CONFIG_PATH'] = INVALID_STORAGE_PATH;
    expect(() => loadConfig()).toThrow('Invalid storage-config.yaml');
  });

  it('throws when LLM YAML has invalid content (missing provider section)', () => {
    setAll();
    process.env['LLM_CONFIG_PATH'] = INVALID_LLM_PATH;
    expect(() => loadConfig()).toThrow('Invalid llm-config.yaml');
  });

  // --- Invalid env var values ---

  it('throws for non-numeric API_PORT', () => {
    setAll();
    process.env['API_PORT'] = 'not-a-number';
    expect(() => loadConfig()).toThrow('API_PORT');
  });
});

// --- parseStorageConfig standalone tests ---

describe('parseStorageConfig()', () => {
  it('validates active provider section is present for sqlite', () => {
    const valid = {
      storage: {
        provider: 'sqlite',
        sqlite: { databasePath: ':memory:' },
      },
    };
    const result = parseStorageConfig(valid);
    expect(result.provider).toBe('sqlite');
    expect(result.sqlite!.databasePath).toBe(':memory:');
  });

  it('throws when active provider section is missing', () => {
    const invalid = {
      storage: {
        provider: 'sqlite',
        // no sqlite section
      },
    };
    expect(() => parseStorageConfig(invalid)).toThrow('Invalid storage configuration');
  });

  it('throws when provider is unknown', () => {
    const invalid = {
      storage: {
        provider: 'unknown-provider',
      },
    };
    expect(() => parseStorageConfig(invalid)).toThrow('Invalid storage configuration');
  });
});

// --- parseLlmConfig standalone tests ---

describe('parseLlmConfig()', () => {
  it('validates active provider section is present for openai', () => {
    const valid = {
      llm: {
        provider: 'openai',
        temperature: 0.7,
        model: 'gpt-4',
        openai: { apiKey: 'sk-test' },
      },
    };
    const result = parseLlmConfig(valid);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
    expect(result.openai!.apiKey).toBe('sk-test');
  });

  it('throws when active provider section is missing', () => {
    const invalid = {
      llm: {
        provider: 'openai',
        temperature: 0.7,
        model: 'gpt-4',
        // no openai section
      },
    };
    expect(() => parseLlmConfig(invalid)).toThrow('Invalid LLM configuration');
  });

  it('throws when required field (model) is missing', () => {
    const invalid = {
      llm: {
        provider: 'openai',
        temperature: 0.7,
        // no model
        openai: { apiKey: 'sk-test' },
      },
    };
    expect(() => parseLlmConfig(invalid)).toThrow('Invalid LLM configuration');
  });
});
