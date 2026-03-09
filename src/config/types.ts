// =====================================================================
// Storage Provider Types
// =====================================================================

export type StorageProvider = 'sqlite' | 'sqlserver' | 'azure-blob';

export type AzureBlobAuthMethod = 'connection-string' | 'azure-identity';

export type TimePeriodFormat = 'monthly' | 'weekly' | 'daily';

export interface SqliteConfig {
  readonly databasePath: string;
}

export interface SqlServerConfig {
  readonly server: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly encrypt: boolean;
  readonly trustServerCertificate: boolean;
}

export interface AzureBlobConfig {
  readonly authMethod: AzureBlobAuthMethod;
  /** Required when authMethod = 'connection-string' */
  readonly connectionString?: string | undefined;
  /** Required when authMethod = 'azure-identity' */
  readonly accountName?: string | undefined;
  readonly containerName: string;
  readonly timePeriodFormat: TimePeriodFormat;
}

/**
 * Discriminated union for storage configuration.
 * The `provider` field determines which sub-config is guaranteed present.
 */
export interface StorageConfig {
  readonly provider: StorageProvider;
  readonly sqlite?: SqliteConfig | undefined;
  readonly sqlserver?: SqlServerConfig | undefined;
  readonly 'azure-blob'?: AzureBlobConfig | undefined;
}

// =====================================================================
// LLM Provider Types
// =====================================================================

export type LlmProvider = 'openai' | 'anthropic' | 'google';

export interface OpenAiProviderConfig {
  readonly apiKey: string;
  /** OPTIONAL: exception to no-fallback rule */
  readonly organization?: string | undefined;
  /** OPTIONAL: exception to no-fallback rule. For Azure OpenAI or custom endpoints. */
  readonly baseUrl?: string | undefined;
}

export interface AnthropicProviderConfig {
  readonly apiKey: string;
  /** OPTIONAL: exception to no-fallback rule. For custom endpoints. */
  readonly baseUrl?: string | undefined;
}

export interface GoogleProviderConfig {
  readonly apiKey: string;
}

/**
 * LLM configuration sourced from llm-config.yaml.
 * temperature and model are shared across all providers.
 * The provider-specific section matching `provider` is guaranteed present.
 */
export interface LlmConfig {
  readonly provider: LlmProvider;
  readonly temperature: number;
  readonly model: string;
  readonly openai?: OpenAiProviderConfig | undefined;
  readonly anthropic?: AnthropicProviderConfig | undefined;
  readonly google?: GoogleProviderConfig | undefined;
}

// =====================================================================
// Top-Level Application Config
// =====================================================================

/**
 * Complete application configuration.
 *
 * - storage: from storage-config.yaml (via STORAGE_CONFIG_PATH env var)
 * - llm: from llm-config.yaml (via LLM_CONFIG_PATH env var)
 * - watchDirectory, apiPort, consolidationIntervalMs: from environment variables
 *
 * All fields are required. No defaults. No fallbacks.
 * Missing any parameter causes an exception at startup.
 */
export interface AppConfig {
  readonly storage: StorageConfig;
  readonly llm: LlmConfig;
  /** Path to inbox directory for file watching (env: WATCH_DIRECTORY) */
  readonly watchDirectory: string;
  /** HTTP server port number 1-65535 (env: API_PORT) */
  readonly apiPort: number;
  /** Consolidation loop interval in milliseconds >= 1000 (env: CONSOLIDATION_INTERVAL_MS) */
  readonly consolidationIntervalMs: number;
}
