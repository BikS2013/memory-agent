# Refined Request: Multi-Storage Backend & YAML-Based LLM Configuration

**Date**: 2026-03-09
**Status**: Pending Review
**Relates To**: Always-On Memory Agent v1.0

---

## Objective

Enhance the Always-On Memory Agent to support multiple storage backends (SQLite, SQL Server, Azure Blob Storage) and multiple LLM providers, both governed by dedicated YAML configuration files (`storage-config.yaml` and `llm-config.yaml`). This replaces the current single-backend SQLite approach and the environment-variable-only LLM configuration with a more flexible, declarative configuration model.

---

## Scope

### In Scope

1. **Storage Abstraction Layer** -- Introduce a repository interface pattern that decouples the agent logic from the underlying storage technology.
2. **SQLite Backend** -- Retain the existing better-sqlite3 implementation as one backend option, refactored to implement the new storage interface.
3. **SQL Server Backend** -- Add a SQL Server storage backend using the `mssql` npm package (or equivalent), implementing the same storage interface.
4. **Azure Blob Storage Backend** -- Add an Azure Blob Storage backend using `@azure/storage-blob`, implementing the storage interface with a document-oriented approach (JSON blobs keyed by username and time period).
5. **storage-config.yaml** -- A YAML configuration file that declares which storage backend is active and all required connection parameters for each backend type.
6. **llm-config.yaml** -- A YAML configuration file that declares which LLM provider is active and all required configuration parameters, replacing the current `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` environment variables.
7. **LangChain.js Integration** -- Continue using LangChain.js (already in place) for LLM integration; extend the provider factory to consume configuration from the YAML file.
8. **Configuration Loading Overhaul** -- Refactor `src/config/config.ts` to load from YAML files while retaining environment variable support for non-storage/non-LLM settings (e.g., `API_PORT`, `WATCH_DIRECTORY`, `CONSOLIDATION_INTERVAL_MS`).

### Out of Scope

- Migration tooling between storage backends (e.g., SQLite-to-SQL-Server data migration).
- Multi-backend simultaneous usage (only one storage backend is active at a time).
- New LLM providers beyond the currently supported three (openai, anthropic, google); however, the YAML structure must be extensible.
- Changes to the Client SDK interface (Unit H) -- the SDK interacts via HTTP and is unaffected.
- Changes to the HTTP API contract -- all endpoints remain the same.

---

## Functional Requirements

### FR-1: Storage Interface Abstraction

- **FR-1.1**: Define a `StorageProvider` TypeScript interface (or set of repository interfaces) that all storage backends must implement. This interface must cover all operations currently performed by `MemoryRepository`, `ConsolidationRepository`, and `ProcessedFileRepository`.
- **FR-1.2**: The interface must include, at minimum: `insert`, `getAll`, `getById`, `getUnconsolidated`, `markConsolidated`, `updateConnections`, `deleteById`, `deleteAll`, `getStats` for memories; `insert`, `getAll`, `deleteAll`, `getCount` for consolidations; `isProcessed`, `markProcessed`, `getAll` for processed files.
- **FR-1.3**: A `StorageFactory` must instantiate the correct backend implementation based on `storage-config.yaml`.

### FR-2: SQLite Backend (Existing, Refactored)

- **FR-2.1**: The current better-sqlite3 repositories must be refactored to implement the `StorageProvider` interface.
- **FR-2.2**: All existing functionality must be preserved without behavioral changes.
- **FR-2.3**: The SQLite backend configuration in `storage-config.yaml` requires: `databasePath` (path to the .db file).

### FR-3: SQL Server Backend

- **FR-3.1**: Implement a SQL Server backend using the `mssql` npm package that implements the `StorageProvider` interface.
- **FR-3.2**: The SQL Server schema must mirror the SQLite schema semantically (Memory, Consolidation, ProcessedFile tables with equivalent columns and constraints).
- **FR-3.3**: The SQL Server backend configuration in `storage-config.yaml` requires: `server`, `port`, `database`, `user`, `password`, `encrypt` (boolean), `trustServerCertificate` (boolean).
- **FR-3.4**: Connection pooling must be used for SQL Server connections.
- **FR-3.5**: Schema initialization (CREATE TABLE IF NOT EXISTS equivalent) must be handled on first connection.

### FR-4: Azure Blob Storage Backend

- **FR-4.1**: Implement an Azure Blob Storage backend using `@azure/storage-blob` that implements the `StorageProvider` interface.
- **FR-4.2**: The blob naming convention must use the pattern: `{userId}/{timePeriod}/{dataType}.json`, where:
  - `userId` is the user identifier (e.g., "default" or a specific username).
  - `timePeriod` is a configurable time-bucketing strategy (e.g., "2026-03", "2026-W10", "2026-03-09") that groups memories by time window.
  - `dataType` distinguishes between "memories", "consolidations", and "processed-files".
- **FR-4.3**: Each blob stores a JSON array of the relevant records. Reading loads the full array; writing replaces the full blob content (read-modify-write pattern).
- **FR-4.4**: The Azure Blob Storage configuration in `storage-config.yaml` requires: `connectionString`, `containerName`, `timePeriodFormat` (one of: "monthly", "weekly", "daily").
- **FR-4.5**: Auto-ID generation for memories and consolidations must be handled within the blob data (e.g., max existing ID + 1, or UUID).
- **FR-4.6**: The `getUnconsolidated` and `markConsolidated` operations must work correctly across time-period blobs (may require scanning multiple blobs or maintaining an index blob).

### FR-5: storage-config.yaml

- **FR-5.1**: The file must be located at a configurable path, with the path itself specified via the `STORAGE_CONFIG_PATH` environment variable.
- **FR-5.2**: The YAML structure must follow this schema:
  ```yaml
  storage:
    provider: "sqlite" | "sqlserver" | "azure-blob"
    sqlite:
      databasePath: <string>      # Required when provider=sqlite
    sqlserver:
      server: <string>            # Required when provider=sqlserver
      port: <number>
      database: <string>
      user: <string>
      password: <string>
      encrypt: <boolean>
      trustServerCertificate: <boolean>
    azure-blob:
      connectionString: <string>  # Required when provider=azure-blob
      containerName: <string>
      timePeriodFormat: "monthly" | "weekly" | "daily"
  ```
- **FR-5.3**: Only the section matching the active `provider` is validated. Sections for inactive providers may be absent or incomplete.
- **FR-5.4**: All fields in the active provider section are mandatory. Missing fields must raise an exception at startup. No defaults. No fallbacks.
- **FR-5.5**: The YAML file must be parsed using a well-established library (e.g., `js-yaml`).

### FR-6: llm-config.yaml

- **FR-6.1**: The file must be located at a configurable path, with the path itself specified via the `LLM_CONFIG_PATH` environment variable.
- **FR-6.2**: The YAML structure must follow this schema:
  ```yaml
  llm:
    provider: "openai" | "anthropic" | "google"
    temperature: <number>          # Required, 0.0 - 2.0
    model: <string>                # Required
    openai:
      apiKey: <string>             # Required when provider=openai
      organization: <string>       # Optional, only validated when provider=openai
      baseUrl: <string>            # Optional, for Azure OpenAI or custom endpoints
    anthropic:
      apiKey: <string>             # Required when provider=anthropic
      baseUrl: <string>            # Optional, for custom endpoints
    google:
      apiKey: <string>             # Required when provider=google
  ```
- **FR-6.3**: Only the section matching the active `provider` is validated. Sections for inactive providers may be absent or incomplete.
- **FR-6.4**: All required fields in the active provider section are mandatory. Missing required fields must raise an exception at startup. No defaults. No fallbacks.
- **FR-6.5**: The `temperature` and `model` fields are top-level (shared across providers) since they apply uniformly.
- **FR-6.6**: The existing `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` environment variables must be removed. All LLM configuration moves to the YAML file exclusively.

### FR-7: Configuration Loading Changes

- **FR-7.1**: The `loadConfig()` function must be refactored to:
  - Read `STORAGE_CONFIG_PATH` and `LLM_CONFIG_PATH` from environment variables.
  - Parse and validate both YAML files.
  - Continue reading `WATCH_DIRECTORY`, `API_PORT`, and `CONSOLIDATION_INTERVAL_MS` from environment variables.
- **FR-7.2**: The `AppConfig` interface must be updated to reflect the new structure, replacing flat LLM/database fields with structured storage and LLM configuration objects.
- **FR-7.3**: The `DATABASE_PATH` environment variable must be removed (replaced by `storage-config.yaml`).

### FR-8: Provider Factory Update

- **FR-8.1**: The `createLlm()` function in `src/llm/provider-factory.ts` must be updated to accept the new LLM configuration structure from the parsed YAML.
- **FR-8.2**: The factory must continue to use LangChain.js classes (`ChatOpenAI`, `ChatAnthropic`, `ChatGoogleGenerativeAI`).
- **FR-8.3**: Optional fields (e.g., `organization`, `baseUrl`) must be passed to LangChain constructors when present.

---

## Technical Constraints

1. **No fallback values**: All required configuration parameters must be explicitly provided. Missing values must cause a startup exception. This is a project-wide convention with no exceptions unless pre-approved and documented in CLAUDE.md.
2. **TypeScript**: All implementation must be in TypeScript, consistent with the existing codebase.
3. **LangChain.js**: LLM integration must use LangChain.js (already in use).
4. **No SQLAlchemy**: Not applicable (Python constraint from global rules), but reinforces that direct SQL or lightweight abstractions are preferred.
5. **Repository Pattern**: The storage abstraction must follow the repository pattern already established in the codebase, not introduce an ORM.
6. **Existing API Stability**: The HTTP API endpoints and the Client SDK must remain unchanged. The storage and LLM changes are internal.
7. **Single Active Backend**: Only one storage backend is active at any time. No multi-backend fan-out.
8. **Azure Blob Read-Modify-Write**: Azure Blob Storage does not support partial updates. The implementation must handle concurrency carefully (consider ETags or lease-based locking for the blob operations).

---

## Acceptance Criteria

### AC-1: Storage Backend Switching
- The agent starts successfully with `storage-config.yaml` set to `provider: "sqlite"` and all SQLite-specific fields populated. Existing SQLite behavior is unchanged.
- The agent starts successfully with `storage-config.yaml` set to `provider: "sqlserver"` and all SQL Server-specific fields populated. All CRUD operations work correctly.
- The agent starts successfully with `storage-config.yaml` set to `provider: "azure-blob"` and all Azure Blob-specific fields populated. All CRUD operations work correctly.

### AC-2: Blob Naming Convention
- When using Azure Blob Storage, memories for user "john" in March 2026 with monthly bucketing are stored at `john/2026-03/memories.json`.
- Queries correctly retrieve data across the relevant time-period blobs.

### AC-3: LLM Configuration via YAML
- The agent starts successfully with `llm-config.yaml` set to each supported provider (openai, anthropic, google) and the appropriate provider-specific fields populated.
- The agent refuses to start and throws a clear error if `llm-config.yaml` is missing, malformed, or has missing required fields for the active provider.

### AC-4: Configuration Validation
- The agent refuses to start and throws a clear error if `storage-config.yaml` is missing, malformed, or has missing required fields for the active provider.
- The agent refuses to start and throws a clear error if `STORAGE_CONFIG_PATH` or `LLM_CONFIG_PATH` environment variables are not set.

### AC-5: Backward Compatibility
- All existing HTTP API endpoints continue to function identically regardless of which storage backend is active.
- The Client SDK continues to work without any code changes.

### AC-6: Environment Variable Cleanup
- The environment variables `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, and `DATABASE_PATH` are no longer read or required.
- The remaining environment variables are: `STORAGE_CONFIG_PATH`, `LLM_CONFIG_PATH`, `WATCH_DIRECTORY`, `API_PORT`, `CONSOLIDATION_INTERVAL_MS`.

---

## Open Questions

1. **Azure Blob Concurrency**: Should the Azure Blob Storage backend use optimistic concurrency (ETags) or pessimistic locking (blob leases) for the read-modify-write cycle? ETags are simpler but may cause retry loops under high concurrency.

2. **Cross-Period Queries (Azure Blob)**: When querying memories on Azure Blob Storage, should the system scan all time-period blobs for a user, or only the current period? Scanning all periods is correct but may become slow with many periods. Should an index blob be maintained?

3. **Time Period Granularity**: The request mentions "time period indicator." The proposed options are monthly, weekly, and daily. Should there be a "none" option that puts all data in a single blob per user (simpler but no time partitioning)?

4. **SQL Server Authentication**: Should the SQL Server backend support Windows Authentication (Integrated Security) in addition to SQL Authentication (user/password)? This affects the YAML schema.

5. **Azure Blob Connection String vs. Managed Identity**: Should the Azure Blob backend also support Azure Managed Identity authentication (DefaultAzureCredential) as an alternative to connection strings? This is a common pattern in Azure deployments.

6. **YAML File Hot-Reload**: Should changes to the YAML configuration files be detected at runtime, or is a restart required? The current proposal assumes restart-only.

7. **Migration Path**: When switching from SQLite to SQL Server (or vice versa), is there a need for a data migration utility, or is this explicitly out of scope for this phase?

8. **ProcessedFile in Azure Blob**: The ProcessedFile table tracks which inbox files have been ingested. In the Azure Blob backend, should this be a separate blob (e.g., `{userId}/processed-files.json`) or follow the same time-period bucketing? Since processed files are not time-scoped by nature, a single blob per user may be more appropriate.

---

## Original Request

> "I want you to enhance the design and implementation to support:
> - different options for the database used. At least I need support for sqllite(current option), sql server, and Azure blob storage
> - particularly for the blob storage option, I suggest to investigate the option of using the user name as the file name (probably combined with a time period indicator) used to store and retrieve the user 'memories'
> - to support the multiple storage options, I want you to consider the option of creating a dedicated yaml configuration file (storage-config.yaml) where the various options available will be registered.
> - I want you also to support different LLM options.
> - I want you to use the langchain library to integrate the various LLM options.
> - I want you to introduce the llm-config.yaml file as a uniform way to describe the configuration parameters for the LLMs used by the agent."
