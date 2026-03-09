# Plan 002: Multi-Storage Backend & YAML-Based LLM Configuration

**Created**: 2026-03-09
**Type**: Enhancement -- Multi-backend storage, YAML configuration, sync-to-async migration
**Development Mode**: Solo agentic development with incremental verification
**Prerequisites**: Plan 001 completed (v1.0 codebase operational)

---

## Overview

This plan enhances the Always-On Memory Agent to support multiple storage backends (SQLite, SQL Server, Azure Blob Storage) and YAML-based configuration for both storage and LLM providers. The work is organized into 9 phases with clear dependencies. The most disruptive cross-cutting change -- the sync-to-async migration -- is addressed as a foundational step within Phase 3.

### Key Architectural Decisions

1. **All repository interfaces are async** (`Promise<T>` return types) to accommodate SQL Server and Azure Blob Storage
2. **SQLite operations are wrapped in async** despite being synchronous internally, prioritizing interface consistency
3. **YAML parsing uses js-yaml + Zod** for type-safe parsing and conditional validation
4. **Single active backend** -- only one storage provider is active at any time
5. **No fallback values** -- all required configuration fields must be explicitly provided or an exception is raised at startup
6. **Database tables use singular names** -- `Memory`, `Consolidation`, `ProcessedFile`

### Dependency Graph

```
Phase 1 (YAML Config) ----+----> Phase 4 (LLM Factory)
                           |
Phase 2 (Interfaces) -----+----> Phase 3 (SQLite Async Refactor)
                           |            |
                           |            v
                           +----> Phase 5 (Consumer Async Update)
                           |            |
                           |            v
                           +----> Phase 6 (SQL Server) --------+
                           |                                    |
                           +----> Phase 7 (Azure Blob) --------+
                                                                |
                                                                v
                                                         Phase 8 (Storage Factory + Config Integration)
                                                                |
                                                                v
                                                         Phase 9 (Tests)
```

### Parallelization Opportunities

| Parallel Group | Phases | Rationale |
|----------------|--------|-----------|
| Group A | Phase 1 + Phase 2 | No dependency between YAML infra and interface definitions |
| Group B | Phase 4 (after Phase 1) + Phase 3 (after Phase 2) | LLM factory refactor is independent of SQLite async refactor |
| Group C | Phase 6 + Phase 7 (after Phase 5) | SQL Server and Azure Blob backends are independent of each other |

---

## Phase 1: YAML Configuration Infrastructure

**Objective**: Install `js-yaml`, define Zod schemas for `storage-config.yaml` and `llm-config.yaml`, and implement YAML loading/validation utilities.

**Dependencies**: None (starting point)

**Estimated Effort**: Small

### New Dependencies to Install

| Package | Purpose |
|---------|---------|
| `js-yaml` | YAML parsing |
| `@types/js-yaml` | TypeScript definitions for js-yaml |

> **Note**: Zod is already present in the project (used for LLM output schemas).

### Files to Create

| File | Purpose |
|------|---------|
| `src/config/yaml-loader.ts` | Generic YAML file loader: reads file, parses with js-yaml, returns unknown |
| `src/config/storage-config-schema.ts` | Zod schema for `storage-config.yaml` with conditional validation per active provider |
| `src/config/llm-config-schema.ts` | Zod schema for `llm-config.yaml` with conditional validation per active provider |

### Files to Modify

| File | Change |
|------|--------|
| `src/config/types.ts` | Add `StorageConfig`, `SqliteConfig`, `SqlServerConfig`, `AzureBlobConfig`, `LlmConfig`, `OpenAiConfig`, `AnthropicConfig`, `GoogleConfig` types. Restructure `AppConfig` to hold nested `storage: StorageConfig`, `llm: LlmConfig`, plus remaining env-var fields (`watchDirectory`, `apiPort`, `consolidationIntervalMs`) |
| `src/config/config.ts` | Refactor `loadConfig()` to: (1) read `STORAGE_CONFIG_PATH` and `LLM_CONFIG_PATH` from env vars (throw if missing), (2) load and validate both YAML files using Zod schemas, (3) continue reading `WATCH_DIRECTORY`, `API_PORT`, `CONSOLIDATION_INTERVAL_MS` from env vars. Remove reads of `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH` |
| `src/config/validation.ts` | Rewrite to validate the new `AppConfig` structure. YAML-sourced sections are validated by Zod schemas; env-var-sourced fields validated here (port range, positive interval, non-empty watch directory) |
| `src/config/index.ts` | Update barrel exports with new types and schemas |

### Zod Schema Design: storage-config.yaml

```typescript
// Outer schema parses the full YAML, inner validation is conditional
const storageConfigSchema = z.object({
  storage: z.object({
    provider: z.enum(['sqlite', 'sqlserver', 'azure-blob']),
    sqlite: z.object({
      databasePath: z.string().min(1),
    }).optional(),
    sqlserver: z.object({
      server: z.string().min(1),
      port: z.number().int().positive(),
      database: z.string().min(1),
      user: z.string().min(1),
      password: z.string().min(1),
      encrypt: z.boolean(),
      trustServerCertificate: z.boolean(),
    }).optional(),
    'azure-blob': z.object({
      connectionString: z.string().min(1),
      containerName: z.string().min(1),
      timePeriodFormat: z.enum(['monthly', 'weekly', 'daily']),
    }).optional(),
  }),
}).refine(
  (data) => {
    switch (data.storage.provider) {
      case 'sqlite': return data.storage.sqlite !== undefined;
      case 'sqlserver': return data.storage.sqlserver !== undefined;
      case 'azure-blob': return data.storage['azure-blob'] !== undefined;
      default: return false;
    }
  },
  { message: 'Configuration section for the active storage provider is missing' }
);
```

### Zod Schema Design: llm-config.yaml

```typescript
const llmConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['openai', 'anthropic', 'google']),
    temperature: z.number().min(0).max(2),
    model: z.string().min(1),
    openai: z.object({
      apiKey: z.string().min(1),
      organization: z.string().optional(),  // Explicitly optional
      baseUrl: z.string().optional(),        // Explicitly optional
    }).optional(),
    anthropic: z.object({
      apiKey: z.string().min(1),
      baseUrl: z.string().optional(),        // Explicitly optional
    }).optional(),
    google: z.object({
      apiKey: z.string().min(1),
    }).optional(),
  }),
}).refine(
  (data) => {
    switch (data.llm.provider) {
      case 'openai': return data.llm.openai !== undefined;
      case 'anthropic': return data.llm.anthropic !== undefined;
      case 'google': return data.llm.google !== undefined;
      default: return false;
    }
  },
  { message: 'Configuration section for the active LLM provider is missing' }
);
```

### Verification Criteria

- [ ] `js-yaml` and `@types/js-yaml` installed and importable
- [ ] A valid `storage-config.yaml` (provider=sqlite) parses and validates without error
- [ ] A valid `llm-config.yaml` (provider=openai) parses and validates without error
- [ ] Missing `STORAGE_CONFIG_PATH` env var throws a descriptive exception
- [ ] Missing `LLM_CONFIG_PATH` env var throws a descriptive exception
- [ ] A `storage-config.yaml` with `provider: "sqlserver"` but missing `sqlserver` section throws a Zod validation error
- [ ] A `llm-config.yaml` with `provider: "anthropic"` but missing `apiKey` throws a Zod validation error
- [ ] `loadConfig()` returns the restructured `AppConfig` with nested `storage` and `llm` objects
- [ ] The old env vars `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH` are no longer read
- [ ] Project compiles with `tsc --noEmit`

---

## Phase 2: Repository Interface Definitions

**Objective**: Define async TypeScript interfaces (`IMemoryRepository`, `IConsolidationRepository`, `IProcessedFileRepository`) that all storage backends must implement. Define the `StorageBundle` return type for the storage factory.

**Dependencies**: None (can run in parallel with Phase 1)

**Estimated Effort**: Small

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/interfaces.ts` | `IMemoryRepository`, `IConsolidationRepository`, `IProcessedFileRepository` interfaces with all methods returning `Promise<T>`. Also defines `StorageBundle` type |

### Files to Modify

| File | Change |
|------|--------|
| `src/database/types.ts` | No changes -- existing row/input types (`MemoryRow`, `NewMemory`, `ConsolidationRow`, `NewConsolidation`, `ProcessedFileRow`, `ConnectionEntry`, `MemoryStats`) remain as-is |
| `src/database/index.ts` | Export new interfaces from barrel |

### Interface Signatures

```typescript
interface IMemoryRepository {
  insert(memory: NewMemory): Promise<MemoryRow>;
  getAll(): Promise<MemoryRow[]>;
  getById(id: number): Promise<MemoryRow | undefined>;
  getUnconsolidated(): Promise<MemoryRow[]>;
  markConsolidated(ids: number[]): Promise<void>;
  updateConnections(id: number, connections: ConnectionEntry[]): Promise<void>;
  deleteById(id: number): Promise<boolean>;
  deleteAll(): Promise<number>;
  getStats(): Promise<MemoryStats>;
}

interface IConsolidationRepository {
  insert(consolidation: NewConsolidation): Promise<ConsolidationRow>;
  getAll(): Promise<ConsolidationRow[]>;
  deleteAll(): Promise<number>;
  getCount(): Promise<number>;
}

interface IProcessedFileRepository {
  isProcessed(filePath: string): Promise<boolean>;
  markProcessed(filePath: string): Promise<void>;
  getAll(): Promise<ProcessedFileRow[]>;
}

interface StorageBundle {
  memoryRepo: IMemoryRepository;
  consolidationRepo: IConsolidationRepository;
  processedFileRepo: IProcessedFileRepository;
  close(): Promise<void>;
}
```

### Verification Criteria

- [ ] All three interfaces are defined and exported
- [ ] `StorageBundle` type is defined and exported
- [ ] Interface method signatures match the existing concrete class methods (same parameter/return types, but wrapped in `Promise`)
- [ ] No existing code is broken (interfaces are additive at this stage)
- [ ] Project compiles with `tsc --noEmit`

---

## Phase 3: Refactor SQLite Repositories to Async Interfaces

**Objective**: Refactor the existing SQLite repository classes to implement the new async interfaces. This is the foundational sync-to-async migration step. The classes are moved into a `src/database/sqlite/` subdirectory.

**Dependencies**: Phase 2 (interfaces must exist)

**Estimated Effort**: Medium

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/sqlite/sqlite-memory-repository.ts` | `SqliteMemoryRepository implements IMemoryRepository` -- wraps existing sync better-sqlite3 calls in async methods |
| `src/database/sqlite/sqlite-consolidation-repository.ts` | `SqliteConsolidationRepository implements IConsolidationRepository` |
| `src/database/sqlite/sqlite-processed-file-repository.ts` | `SqliteProcessedFileRepository implements IProcessedFileRepository` |
| `src/database/sqlite/connection.ts` | Moved from `src/database/connection.ts` -- `initializeSqliteDatabase(dbPath): Database.Database` and `closeSqliteDatabase(db): void` |
| `src/database/sqlite/schema.ts` | Moved from `src/database/schema.ts` -- SQLite-specific DDL |
| `src/database/sqlite/index.ts` | Barrel export for SQLite backend |

### Files to Modify

| File | Change |
|------|--------|
| `src/database/memory-repository.ts` | **Delete or deprecate** -- replaced by `sqlite/sqlite-memory-repository.ts` |
| `src/database/consolidation-repository.ts` | **Delete or deprecate** -- replaced by `sqlite/sqlite-consolidation-repository.ts` |
| `src/database/processed-file-repository.ts` | **Delete or deprecate** -- replaced by `sqlite/sqlite-processed-file-repository.ts` |
| `src/database/connection.ts` | **Delete or deprecate** -- moved to `sqlite/connection.ts` |
| `src/database/schema.ts` | **Delete or deprecate** -- moved to `sqlite/schema.ts` |
| `src/database/index.ts` | Update barrel: export interfaces, types, and SQLite-specific classes from `./sqlite/` |

### Async Wrapping Pattern

Since better-sqlite3 is synchronous, each method wraps the existing logic:

```typescript
async insert(memory: NewMemory): Promise<MemoryRow> {
  // Existing synchronous better-sqlite3 logic, unchanged
  const stmt = this.db.prepare(/*...*/);
  const result = stmt.run(/*...*/);
  // Return the row (same logic as before)
  return this.getById(result.lastInsertRowid as number) as Promise<MemoryRow>;
}
```

The wrapping is implicit: an `async` function returning a non-Promise value automatically wraps it in a resolved Promise. No explicit `Promise.resolve()` calls needed.

### Verification Criteria

- [ ] All three SQLite repository classes implement their respective interfaces
- [ ] All existing method logic is preserved (no behavioral changes)
- [ ] The old files (`memory-repository.ts`, `consolidation-repository.ts`, `processed-file-repository.ts`, `connection.ts`, `schema.ts`) are removed from `src/database/` root
- [ ] The SQLite backend can be instantiated and all methods work correctly
- [ ] Project compiles with `tsc --noEmit`
- [ ] Note: Consumers will NOT compile yet (they still reference old synchronous classes) -- this is expected and resolved in Phase 5

---

## Phase 4: Refactor LLM Provider Factory for YAML Config

**Objective**: Update `createLlm()` to accept the new `LlmConfig` type from the parsed YAML, replacing the flat `AppConfig` parameter. Support `temperature` from config (currently hardcoded to 0) and optional fields (`organization`, `baseUrl`).

**Dependencies**: Phase 1 (LlmConfig type must exist in `src/config/types.ts`)

**Estimated Effort**: Small

### Files to Modify

| File | Change |
|------|--------|
| `src/llm/provider-factory.ts` | Change signature from `createLlm(config: AppConfig)` to `createLlm(llmConfig: LlmConfig)`. Switch on `llmConfig.provider`. Use `llmConfig.temperature` instead of hardcoded `0`. Pass `llmConfig.openai.organization`, `llmConfig.openai.baseUrl`, `llmConfig.anthropic.baseUrl` when present. Use `llmConfig[provider].apiKey` for the active provider |
| `src/llm/types.ts` | No changes expected (LLM output types are independent of config) |
| `src/llm/index.ts` | Update barrel if needed |

### Updated Factory Logic

```typescript
function createLlm(llmConfig: LlmConfig): BaseChatModel {
  switch (llmConfig.provider) {
    case 'openai': {
      const openaiConfig = llmConfig.openai!; // Guaranteed present by Zod validation
      return new ChatOpenAI({
        modelName: llmConfig.model,
        temperature: llmConfig.temperature,
        openAIApiKey: openaiConfig.apiKey,
        ...(openaiConfig.organization && { organization: openaiConfig.organization }),
        ...(openaiConfig.baseUrl && { configuration: { baseURL: openaiConfig.baseUrl } }),
      });
    }
    case 'anthropic': {
      const anthropicConfig = llmConfig.anthropic!;
      return new ChatAnthropic({
        modelName: llmConfig.model,
        temperature: llmConfig.temperature,
        anthropicApiKey: anthropicConfig.apiKey,
        ...(anthropicConfig.baseUrl && { clientOptions: { baseURL: anthropicConfig.baseUrl } }),
      });
    }
    case 'google': {
      const googleConfig = llmConfig.google!;
      return new ChatGoogleGenerativeAI({
        modelName: llmConfig.model,
        temperature: llmConfig.temperature,
        apiKey: googleConfig.apiKey,
      });
    }
    default:
      throw new Error(`Unsupported LLM provider: ${(llmConfig as never)}`);
  }
}
```

### Verification Criteria

- [ ] `createLlm()` accepts `LlmConfig` and returns `BaseChatModel`
- [ ] Temperature is read from config, not hardcoded
- [ ] Optional `organization` and `baseUrl` are passed when present and omitted when absent
- [ ] Exhaustive switch still uses `never` pattern for unsupported providers
- [ ] Project compiles with `tsc --noEmit`
- [ ] Manually verify with one LLM provider that the agent can still perform an ingest operation

---

## Phase 5: Update All Consumers to Async

**Objective**: Update all modules that consume repositories to use the async interfaces with `await`. Update type references from concrete classes to interfaces. Update the entry point (`src/index.ts`) to use the new config structure and interface types.

**Dependencies**: Phase 3 (async SQLite repos must exist), Phase 4 (LLM factory must accept new config)

**Estimated Effort**: Medium-Large (most files touched, but changes are mechanical)

### Files to Modify

| File | Change |
|------|--------|
| `src/agents/ingest-agent.ts` | Change constructor param type from `MemoryRepository` to `IMemoryRepository`. Add `await` to all `this.memoryRepo.*()` calls. Make methods that call repo `async` if not already |
| `src/agents/consolidate-agent.ts` | Change param types to `IMemoryRepository`, `IConsolidationRepository`. Add `await` to all repo calls. Make methods `async` |
| `src/agents/query-agent.ts` | Change param types to `IMemoryRepository`, `IConsolidationRepository`. Add `await` to all repo calls. Make methods `async` |
| `src/agents/index.ts` | Update barrel if types change |
| `src/api/types.ts` | Change `ServerDependencies` to reference `IMemoryRepository`, `IConsolidationRepository` instead of concrete classes |
| `src/api/routes.ts` | Add `await` to all repo calls in route handlers. Handlers are likely already async (Fastify pattern), so this is mostly adding `await` keywords |
| `src/api/server.ts` | May need minor type updates if it references repo types |
| `src/watcher/file-watcher.ts` | Change `ProcessedFileRepository` to `IProcessedFileRepository`. Add `await` to `isProcessed()` and `markProcessed()` calls |
| `src/consolidation/consolidation-loop.ts` | Likely no change (calls `consolidateAgent` which is already async), but verify |
| `src/index.ts` | Major rewire: (1) `loadConfig()` now returns restructured `AppConfig`, (2) Replace `initializeDatabase(config.databasePath)` with direct SQLite backend instantiation (temporary -- factory comes in Phase 8), (3) `createLlm(config.llm)` instead of `createLlm(config)`, (4) Construct SQLite repos using new classes, (5) Shutdown calls `close()` on storage bundle |

### Migration Pattern for Agents

Current pattern:
```typescript
class IngestAgent {
  constructor(private llm: BaseChatModel, private memoryRepo: MemoryRepository) {}

  ingest(text: string, source?: string): MemoryRow {
    // ... LLM call (already async) ...
    const row = this.memoryRepo.insert(newMemory);  // sync
    return row;
  }
}
```

After migration:
```typescript
class IngestAgent {
  constructor(private llm: BaseChatModel, private memoryRepo: IMemoryRepository) {}

  async ingest(text: string, source?: string): Promise<MemoryRow> {
    // ... LLM call (already async) ...
    const row = await this.memoryRepo.insert(newMemory);  // now async
    return row;
  }
}
```

### Verification Criteria

- [ ] All agents accept interface types, not concrete classes
- [ ] All repo calls in agents, routes, file watcher use `await`
- [ ] `src/index.ts` wires everything with the new config structure
- [ ] The full application starts successfully with SQLite backend via `storage-config.yaml`
- [ ] All HTTP endpoints work (manual test: POST /ingest, GET /query, GET /status, GET /memories, POST /consolidate, POST /delete, POST /clear)
- [ ] File watcher ingests a dropped `.txt` file
- [ ] Consolidation loop runs after timer tick
- [ ] Graceful shutdown closes the SQLite database
- [ ] Project compiles with `tsc --noEmit`
- [ ] **This is the first full-system verification checkpoint** -- the app must be fully functional with SQLite at the end of this phase

---

## Phase 6: Implement SQL Server Backend

**Objective**: Implement the SQL Server storage backend using the `mssql` npm package. All three repository classes plus connection management and schema initialization.

**Dependencies**: Phase 2 (interfaces), Phase 5 (consumers are async-ready)

**Estimated Effort**: Medium-Large

### New Dependencies to Install

| Package | Purpose |
|---------|---------|
| `mssql` | SQL Server client with connection pooling |
| `@types/mssql` | TypeScript definitions |

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/sqlserver/sqlserver-memory-repository.ts` | `SqlServerMemoryRepository implements IMemoryRepository` using `mssql` parameterized queries |
| `src/database/sqlserver/sqlserver-consolidation-repository.ts` | `SqlServerConsolidationRepository implements IConsolidationRepository` |
| `src/database/sqlserver/sqlserver-processed-file-repository.ts` | `SqlServerProcessedFileRepository implements IProcessedFileRepository` |
| `src/database/sqlserver/connection.ts` | `initializeSqlServerDatabase(config: SqlServerConfig): Promise<sql.ConnectionPool>` -- creates pool, runs schema init. `closeSqlServerDatabase(pool): Promise<void>` |
| `src/database/sqlserver/schema.ts` | SQL Server DDL using `IF OBJECT_ID(...) IS NULL` pattern for `Memory`, `Consolidation`, `ProcessedFile` tables with equivalent columns and indexes |
| `src/database/sqlserver/index.ts` | Barrel export for SQL Server backend |

### SQL Server Schema Design

```sql
-- Memory table (SQL Server equivalent)
IF OBJECT_ID('dbo.Memory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Memory (
    id INT IDENTITY(1,1) PRIMARY KEY,
    userId NVARCHAR(255) NOT NULL DEFAULT 'default',
    content NVARCHAR(MAX) NOT NULL,
    summary NVARCHAR(MAX) NOT NULL,
    entities NVARCHAR(MAX) NOT NULL,      -- JSON array serialized
    topics NVARCHAR(MAX) NOT NULL,         -- JSON array serialized
    importance FLOAT NOT NULL,
    source NVARCHAR(MAX),
    createdAt NVARCHAR(50) NOT NULL,       -- ISO 8601 string
    consolidated BIT NOT NULL DEFAULT 0,
    connections NVARCHAR(MAX) NOT NULL,     -- JSON array serialized
    CONSTRAINT CK_Memory_importance CHECK (importance >= 0.0 AND importance <= 1.0)
  );

  CREATE INDEX idx_memory_userId ON dbo.Memory(userId);
  CREATE INDEX idx_memory_consolidated ON dbo.Memory(consolidated);
  CREATE INDEX idx_memory_importance ON dbo.Memory(importance);
END

-- Consolidation table
IF OBJECT_ID('dbo.Consolidation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Consolidation (
    id INT IDENTITY(1,1) PRIMARY KEY,
    summary NVARCHAR(MAX) NOT NULL,
    insight NVARCHAR(MAX) NOT NULL,
    sourceIds NVARCHAR(MAX) NOT NULL,      -- JSON array serialized
    createdAt NVARCHAR(50) NOT NULL
  );
END

-- ProcessedFile table
IF OBJECT_ID('dbo.ProcessedFile', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProcessedFile (
    id INT IDENTITY(1,1) PRIMARY KEY,
    filePath NVARCHAR(1000) NOT NULL UNIQUE,
    processedAt NVARCHAR(50) NOT NULL
  );
END
```

### Key Implementation Details

- **Connection pooling**: Use `sql.connect(config)` global pool pattern with configurable pool size
- **Parameterized queries**: All queries use `.input()` for SQL injection prevention
- **Transactions**: `markConsolidated()` uses `sql.Transaction` for atomicity
- **JSON serialization**: Same `JSON.stringify()` / `JSON.parse()` pattern as SQLite for array fields
- **NVARCHAR(MAX)**: Used for all text/JSON fields to support Unicode and large content

### Verification Criteria

- [ ] All three SQL Server repository classes implement their respective interfaces
- [ ] Schema initialization creates tables and indexes on first connection
- [ ] Connection pool is established and reused across repository calls
- [ ] All CRUD operations work: insert, getAll, getById, getUnconsolidated, markConsolidated, updateConnections, deleteById, deleteAll, getStats (memory); insert, getAll, deleteAll, getCount (consolidation); isProcessed, markProcessed, getAll (processed file)
- [ ] `markConsolidated()` runs within a transaction
- [ ] Connection pool closes cleanly on shutdown
- [ ] Project compiles with `tsc --noEmit`
- [ ] Integration test against a running SQL Server instance (Docker or Azure)

---

## Phase 7: Implement Azure Blob Storage Backend

**Objective**: Implement the Azure Blob Storage backend using `@azure/storage-blob`. Uses a document-oriented approach with JSON blobs keyed by `{userId}/{timePeriod}/{dataType}.json`.

**Dependencies**: Phase 2 (interfaces), Phase 5 (consumers are async-ready)

**Can run in parallel with**: Phase 6

**Estimated Effort**: Large (most complex backend due to read-modify-write pattern and cross-period queries)

### New Dependencies to Install

| Package | Purpose |
|---------|---------|
| `@azure/storage-blob` | Azure Blob Storage SDK |

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/azure-blob/azure-blob-memory-repository.ts` | `AzureBlobMemoryRepository implements IMemoryRepository` -- read-modify-write JSON blobs |
| `src/database/azure-blob/azure-blob-consolidation-repository.ts` | `AzureBlobConsolidationRepository implements IConsolidationRepository` |
| `src/database/azure-blob/azure-blob-processed-file-repository.ts` | `AzureBlobProcessedFileRepository implements IProcessedFileRepository` -- single blob per user (no time bucketing) |
| `src/database/azure-blob/connection.ts` | `initializeAzureBlobStorage(config: AzureBlobConfig): Promise<ContainerClient>` -- creates container if not exists |
| `src/database/azure-blob/blob-helpers.ts` | Shared utilities: `readJsonBlob<T>()`, `writeJsonBlob<T>()`, `listBlobsByPrefix()`, `generateTimePeriodKey()`, `getAllTimePeriodKeys()` with ETag-based concurrency |
| `src/database/azure-blob/index.ts` | Barrel export for Azure Blob backend |

### Blob Naming Convention

```
{userId}/{timePeriod}/memories.json        -- Array of MemoryRow
{userId}/{timePeriod}/consolidations.json  -- Array of ConsolidationRow
{userId}/processed-files.json              -- Array of ProcessedFileRow (no time bucketing)
```

Time period format based on `timePeriodFormat` config:
- `"monthly"` -> `"2026-03"`
- `"weekly"` -> `"2026-W10"`
- `"daily"` -> `"2026-03-09"`

### Key Implementation Details

- **Read-Modify-Write**: Each mutation reads the full blob, modifies the array, writes back. Uses ETag-based optimistic concurrency with retry loop
- **Auto-ID Generation**: `max(existing IDs) + 1` within the blob, or UUID if preferred. Using incremental integer for consistency with SQL backends
- **Cross-Period Queries**: `getAll()` and `getUnconsolidated()` must scan ALL time-period blobs for the user by listing blobs with prefix `{userId}/`. Results are merged and sorted
- **ProcessedFile**: Stored in a single blob per user (`{userId}/processed-files.json`) without time bucketing since processed file tracking is not time-scoped
- **ETag Concurrency**: Write operations include the ETag condition. On conflict (HTTP 412), retry with a fresh read. Maximum 3 retries before throwing
- **Empty/Missing Blobs**: If a blob does not exist, treat as empty array (not an error)

### Concurrency Pattern

```typescript
async function readModifyWrite<T>(
  blockBlobClient: BlockBlobClient,
  modifier: (items: T[]) => T[],
  maxRetries: number = 3
): Promise<T[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { items, etag } = await readJsonBlob<T>(blockBlobClient);
    const modified = modifier(items);
    try {
      await writeJsonBlob(blockBlobClient, modified, { conditions: { ifMatch: etag } });
      return modified;
    } catch (error) {
      if (error.statusCode === 412 && attempt < maxRetries - 1) {
        continue; // Retry on ETag mismatch
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded for blob write');
}
```

### Verification Criteria

- [ ] All three Azure Blob repository classes implement their respective interfaces
- [ ] Container is created if it does not exist
- [ ] Blob naming follows the `{userId}/{timePeriod}/{dataType}.json` convention
- [ ] Time period formatting is correct for all three formats (monthly, weekly, daily)
- [ ] `getAll()` scans and merges across all time-period blobs for the user
- [ ] `getUnconsolidated()` correctly filters across multiple period blobs
- [ ] `markConsolidated()` updates the correct period blob(s) for the given IDs
- [ ] ETag-based concurrency correctly retries on conflict
- [ ] Missing blobs are treated as empty arrays
- [ ] ProcessedFile blob is at `{userId}/processed-files.json` (no time bucketing)
- [ ] Connection closes cleanly (no-op for blob storage, but `close()` method exists on `StorageBundle`)
- [ ] Project compiles with `tsc --noEmit`
- [ ] Integration test against Azure Storage Emulator (Azurite) or a real Azure account

---

## Phase 8: Storage Factory and Configuration Integration

**Objective**: Implement the `StorageFactory` that reads the `storage` section of the parsed config and instantiates the correct backend. Wire the factory into `src/index.ts`.

**Dependencies**: Phase 3, Phase 5, Phase 6, Phase 7 (all backends must exist)

**Estimated Effort**: Small

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/storage-factory.ts` | `StorageFactory.create(config: StorageConfig): Promise<StorageBundle>` -- switches on `config.provider`, initializes the selected backend, returns `StorageBundle` |

### Files to Modify

| File | Change |
|------|--------|
| `src/database/index.ts` | Export `StorageFactory` from barrel |
| `src/index.ts` | Replace temporary direct SQLite instantiation (from Phase 5) with `StorageFactory.create(config.storage)`. Destructure `{ memoryRepo, consolidationRepo, processedFileRepo, close }` from result. Shutdown calls `close()` |

### Factory Implementation

```typescript
class StorageFactory {
  static async create(config: StorageConfig): Promise<StorageBundle> {
    switch (config.provider) {
      case 'sqlite': {
        const sqliteConfig = config.sqlite!; // Guaranteed by Zod
        const db = initializeSqliteDatabase(sqliteConfig.databasePath);
        return {
          memoryRepo: new SqliteMemoryRepository(db),
          consolidationRepo: new SqliteConsolidationRepository(db),
          processedFileRepo: new SqliteProcessedFileRepository(db),
          close: async () => closeSqliteDatabase(db),
        };
      }
      case 'sqlserver': {
        const sqlServerConfig = config.sqlserver!;
        const pool = await initializeSqlServerDatabase(sqlServerConfig);
        return {
          memoryRepo: new SqlServerMemoryRepository(pool),
          consolidationRepo: new SqlServerConsolidationRepository(pool),
          processedFileRepo: new SqlServerProcessedFileRepository(pool),
          close: async () => closeSqlServerDatabase(pool),
        };
      }
      case 'azure-blob': {
        const blobConfig = config['azure-blob']!;
        const containerClient = await initializeAzureBlobStorage(blobConfig);
        return {
          memoryRepo: new AzureBlobMemoryRepository(containerClient, blobConfig),
          consolidationRepo: new AzureBlobConsolidationRepository(containerClient, blobConfig),
          processedFileRepo: new AzureBlobProcessedFileRepository(containerClient),
          close: async () => { /* No-op for blob storage */ },
        };
      }
      default:
        throw new Error(`Unsupported storage provider: ${(config as never)}`);
    }
  }
}
```

### Verification Criteria

- [ ] `StorageFactory.create()` returns a valid `StorageBundle` for each provider type
- [ ] `src/index.ts` uses the factory for backend instantiation
- [ ] Shutdown cleanly closes the active backend
- [ ] Full application works end-to-end with SQLite via `storage-config.yaml` (provider=sqlite)
- [ ] Full application works end-to-end with SQL Server via `storage-config.yaml` (provider=sqlserver) -- requires running SQL Server
- [ ] Full application works end-to-end with Azure Blob via `storage-config.yaml` (provider=azure-blob) -- requires Azurite or Azure account
- [ ] Switching providers by editing `storage-config.yaml` and restarting works correctly
- [ ] Project compiles with `tsc --noEmit`

---

## Phase 9: Update Tests

**Objective**: Update existing tests and add new tests for all new code: YAML config loading/validation, repository interfaces, all three backends, storage factory, and LLM factory.

**Dependencies**: Phase 8 (all production code must be complete)

**Estimated Effort**: Medium-Large

### Files to Create

| File | Purpose |
|------|---------|
| `test_scripts/test-yaml-config-loading.ts` | Tests for YAML loading: valid configs, missing files, malformed YAML, missing required fields, conditional validation |
| `test_scripts/test-storage-config-validation.ts` | Tests for storage config Zod schema: each provider type, missing sections, invalid values |
| `test_scripts/test-llm-config-validation.ts` | Tests for LLM config Zod schema: each provider type, optional fields, missing required fields |
| `test_scripts/test-sqlite-repositories.ts` | Tests for SQLite backend: all CRUD operations through async interface |
| `test_scripts/test-sqlserver-repositories.ts` | Tests for SQL Server backend: all CRUD operations (requires SQL Server connection) |
| `test_scripts/test-azure-blob-repositories.ts` | Tests for Azure Blob backend: all CRUD operations, cross-period queries, ETag retry (requires Azurite or Azure) |
| `test_scripts/test-storage-factory.ts` | Tests for StorageFactory: creates correct backend for each provider, handles invalid provider |
| `test_scripts/test-llm-factory.ts` | Tests for updated `createLlm()`: each provider, temperature from config, optional fields |

### Files to Modify

| File | Change |
|------|--------|
| Existing test files referencing old `MemoryRepository`, `ConsolidationRepository`, `ProcessedFileRepository` | Update imports to use interface types or new class names. Add `await` to all repo calls |
| Existing test files referencing old `loadConfig()` or `AppConfig` | Update for new config structure |

### Test Categories

**Unit Tests (no external dependencies)**:
- YAML config loading and validation (mock file system reads)
- Zod schema validation for all provider types
- Storage factory instantiation logic
- LLM factory provider selection and parameter passing

**Integration Tests (require external services)**:
- SQLite: In-memory or temp-file database
- SQL Server: Docker container with SQL Server
- Azure Blob: Azurite emulator

### Sample YAML Fixtures

Create test fixture files in `test_scripts/fixtures/`:

| File | Purpose |
|------|---------|
| `test_scripts/fixtures/storage-config-sqlite.yaml` | Valid SQLite config |
| `test_scripts/fixtures/storage-config-sqlserver.yaml` | Valid SQL Server config |
| `test_scripts/fixtures/storage-config-azure-blob.yaml` | Valid Azure Blob config |
| `test_scripts/fixtures/storage-config-invalid.yaml` | Missing required fields |
| `test_scripts/fixtures/llm-config-openai.yaml` | Valid OpenAI config |
| `test_scripts/fixtures/llm-config-anthropic.yaml` | Valid Anthropic config |
| `test_scripts/fixtures/llm-config-google.yaml` | Valid Google config |
| `test_scripts/fixtures/llm-config-invalid.yaml` | Missing required fields |

### Verification Criteria

- [ ] All unit tests pass
- [ ] SQLite integration tests pass
- [ ] SQL Server integration tests pass (with Docker SQL Server running)
- [ ] Azure Blob integration tests pass (with Azurite running)
- [ ] No existing tests are broken
- [ ] Test coverage includes error paths (missing config, invalid YAML, connection failures)
- [ ] Project compiles with `tsc --noEmit`

---

## Complete File Inventory

### New Files (28 files)

| # | File | Phase |
|---|------|-------|
| 1 | `src/config/yaml-loader.ts` | 1 |
| 2 | `src/config/storage-config-schema.ts` | 1 |
| 3 | `src/config/llm-config-schema.ts` | 1 |
| 4 | `src/database/interfaces.ts` | 2 |
| 5 | `src/database/sqlite/sqlite-memory-repository.ts` | 3 |
| 6 | `src/database/sqlite/sqlite-consolidation-repository.ts` | 3 |
| 7 | `src/database/sqlite/sqlite-processed-file-repository.ts` | 3 |
| 8 | `src/database/sqlite/connection.ts` | 3 |
| 9 | `src/database/sqlite/schema.ts` | 3 |
| 10 | `src/database/sqlite/index.ts` | 3 |
| 11 | `src/database/sqlserver/sqlserver-memory-repository.ts` | 6 |
| 12 | `src/database/sqlserver/sqlserver-consolidation-repository.ts` | 6 |
| 13 | `src/database/sqlserver/sqlserver-processed-file-repository.ts` | 6 |
| 14 | `src/database/sqlserver/connection.ts` | 6 |
| 15 | `src/database/sqlserver/schema.ts` | 6 |
| 16 | `src/database/sqlserver/index.ts` | 6 |
| 17 | `src/database/azure-blob/azure-blob-memory-repository.ts` | 7 |
| 18 | `src/database/azure-blob/azure-blob-consolidation-repository.ts` | 7 |
| 19 | `src/database/azure-blob/azure-blob-processed-file-repository.ts` | 7 |
| 20 | `src/database/azure-blob/connection.ts` | 7 |
| 21 | `src/database/azure-blob/blob-helpers.ts` | 7 |
| 22 | `src/database/azure-blob/index.ts` | 7 |
| 23 | `src/database/storage-factory.ts` | 8 |
| 24-28 | `test_scripts/test-*.ts` and `test_scripts/fixtures/*.yaml` (8+ files) | 9 |

### Modified Files (16 files)

| # | File | Phase(s) |
|---|------|----------|
| 1 | `src/config/types.ts` | 1 |
| 2 | `src/config/config.ts` | 1 |
| 3 | `src/config/validation.ts` | 1 |
| 4 | `src/config/index.ts` | 1 |
| 5 | `src/database/index.ts` | 2, 3, 8 |
| 6 | `src/llm/provider-factory.ts` | 4 |
| 7 | `src/llm/index.ts` | 4 |
| 8 | `src/agents/ingest-agent.ts` | 5 |
| 9 | `src/agents/consolidate-agent.ts` | 5 |
| 10 | `src/agents/query-agent.ts` | 5 |
| 11 | `src/agents/index.ts` | 5 |
| 12 | `src/api/types.ts` | 5 |
| 13 | `src/api/routes.ts` | 5 |
| 14 | `src/watcher/file-watcher.ts` | 5 |
| 15 | `src/consolidation/consolidation-loop.ts` | 5 |
| 16 | `src/index.ts` | 5, 8 |

### Deleted Files (5 files)

| # | File | Phase |
|---|------|-------|
| 1 | `src/database/memory-repository.ts` | 3 |
| 2 | `src/database/consolidation-repository.ts` | 3 |
| 3 | `src/database/processed-file-repository.ts` | 3 |
| 4 | `src/database/connection.ts` | 3 |
| 5 | `src/database/schema.ts` | 3 |

### New npm Dependencies (5 packages)

| Package | Dev? | Phase |
|---------|------|-------|
| `js-yaml` | No | 1 |
| `@types/js-yaml` | Yes | 1 |
| `mssql` | No | 6 |
| `@types/mssql` | Yes | 6 |
| `@azure/storage-blob` | No | 7 |

---

## Environment Variables (Final State)

| Variable | Purpose | Source |
|----------|---------|--------|
| `STORAGE_CONFIG_PATH` | Absolute path to `storage-config.yaml` | Required, no fallback |
| `LLM_CONFIG_PATH` | Absolute path to `llm-config.yaml` | Required, no fallback |
| `WATCH_DIRECTORY` | Path to the inbox directory for file watcher | Required, no fallback |
| `API_PORT` | HTTP server port | Required, no fallback |
| `CONSOLIDATION_INTERVAL_MS` | Timer interval for consolidation loop in milliseconds | Required, no fallback |

**Removed**: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH`

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sync-to-async migration introduces subtle bugs (missing `await`) | High | TypeScript strict mode catches most; Phase 5 has comprehensive manual verification |
| Azure Blob cross-period queries are slow with many periods | Medium | Acceptable for initial implementation; index blob optimization can be added later |
| ETag concurrency retries under high contention | Medium | 3-retry limit with clear error; single-agent deployment makes contention unlikely |
| SQL Server connection failures during startup | Medium | Clear error message on connection failure; no retry-loop to avoid masking issues |
| Breaking changes in existing tests | Medium | Phase 9 dedicated to test updates; tests are run after each phase |

---

## Open Questions Carried Forward

These are carried from the refined request and should be resolved during or before implementation:

1. **Azure Blob Concurrency**: ETag-based optimistic concurrency is the chosen approach (simpler, sufficient for single-agent deployment). Lease-based locking deferred.
2. **Cross-Period Queries**: Scan all periods for the user. Index blob optimization deferred to a future enhancement.
3. **ProcessedFile in Azure Blob**: Single blob per user (`{userId}/processed-files.json`), no time bucketing.
4. **SQL Server Authentication**: SQL Authentication (user/password) only. Windows Authentication deferred.
5. **Azure Managed Identity**: Connection string only. DefaultAzureCredential deferred.
6. **YAML Hot-Reload**: Not supported. Restart required for config changes.
7. **Data Migration Utility**: Explicitly out of scope for this plan.
