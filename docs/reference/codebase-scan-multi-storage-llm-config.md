# Codebase Scan: Multi-Storage & LLM Config Changes

**Date**: 2026-03-09
**Purpose**: Understand the current architecture so downstream phases can integrate multi-storage and YAML-based LLM configuration.

---

## 1. Project Structure (src/)

```
src/
  index.ts                          # Entry point / wiring
  config/
    index.ts                        # Barrel: loadConfig, AppConfig, LlmProvider, VALID_LLM_PROVIDERS
    config.ts                       # loadConfig() - reads env vars, calls validateConfig()
    types.ts                        # AppConfig interface, LlmProvider type
    validation.ts                   # validateConfig() - runtime checks on AppConfig
  database/
    index.ts                        # Barrel: types, schema, connection, 3 repositories
    types.ts                        # MemoryRow, NewMemory, ConsolidationRow, NewConsolidation,
                                    #   ProcessedFileRow, ConnectionEntry, MemoryStats
    schema.ts                       # CREATE TABLE DDL statements (SQLite syntax)
    connection.ts                   # initializeDatabase(dbPath), closeDatabase(db)
    memory-repository.ts            # MemoryRepository class (better-sqlite3)
    consolidation-repository.ts     # ConsolidationRepository class (better-sqlite3)
    processed-file-repository.ts    # ProcessedFileRepository class (better-sqlite3)
  llm/
    index.ts                        # Barrel: types, schemas, createLlm, prompts
    provider-factory.ts             # createLlm(config) -> BaseChatModel
    types.ts                        # MemoryExtraction, ConsolidationResult, QueryResult
    schemas.ts                      # Zod schemas for structured LLM output
    prompts.ts                      # System prompts for ingest/consolidate/query
  agents/
    index.ts                        # Barrel: IngestAgent, ConsolidateAgent, QueryAgent
    ingest-agent.ts                 # IngestAgent(llm, memoryRepo)
    consolidate-agent.ts            # ConsolidateAgent(llm, memoryRepo, consolidationRepo)
    query-agent.ts                  # QueryAgent(llm, memoryRepo, consolidationRepo)
  api/
    index.ts                        # Barrel: createServer, startServer, stopServer
    server.ts                       # Fastify server factory
    routes.ts                       # Route handlers (GET/POST endpoints)
    types.ts                        # ServerDependencies, request body types
  watcher/
    index.ts                        # Barrel: FileWatcher, SUPPORTED_EXTENSIONS
    file-watcher.ts                 # FileWatcher(watchDir, ingestAgent, processedFileRepo)
    types.ts                        # SUPPORTED_EXTENSIONS constant
  consolidation/
    index.ts                        # Barrel: ConsolidationLoop
    consolidation-loop.ts           # ConsolidationLoop(consolidateAgent, intervalMs)
  client/
    index.ts                        # Barrel: MemoryClient, client types
    memory-client.ts                # HTTP client SDK
    types.ts                        # Client-side types
```

---

## 2. Current Configuration Pattern

### AppConfig interface (`src/config/types.ts`)

```typescript
interface AppConfig {
  readonly llmProvider: LlmProvider;       // "openai" | "anthropic" | "google"
  readonly llmModel: string;
  readonly llmApiKey: string;
  readonly databasePath: string;
  readonly watchDirectory: string;
  readonly apiPort: number;
  readonly consolidationIntervalMs: number;
}
```

### Loading (`src/config/config.ts`)

- All values from env vars: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH`, `WATCH_DIRECTORY`, `API_PORT`, `CONSOLIDATION_INTERVAL_MS`
- No defaults, no fallbacks -- throws on missing/invalid
- `validateConfig()` in `validation.ts` performs range/type checks

### What changes

- **Remove from env**: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH`
- **Add env vars**: `STORAGE_CONFIG_PATH`, `LLM_CONFIG_PATH`
- **Keep from env**: `WATCH_DIRECTORY`, `API_PORT`, `CONSOLIDATION_INTERVAL_MS`
- **AppConfig** must be restructured to hold parsed YAML objects instead of flat LLM/DB fields
- **validation.ts** must be rewritten for YAML-sourced config sections
- New dependency: `js-yaml` for YAML parsing

### Files affected

| File | Change |
|------|--------|
| `src/config/types.ts` | Replace `AppConfig` with new structure containing `StorageConfig`, `LlmConfig` sub-types |
| `src/config/config.ts` | Load YAML files, parse, validate; keep env for remaining 3 vars |
| `src/config/validation.ts` | Rewrite for YAML-based storage/LLM validation |
| `src/config/index.ts` | Update barrel exports with new types |

---

## 3. Current Storage Pattern

### Repository Classes (all in `src/database/`)

Three concrete classes, each takes `Database.Database` (better-sqlite3) in constructor:

**MemoryRepository** -- 10 methods:
- `insert(memory: NewMemory): MemoryRow`
- `getAll(): MemoryRow[]`
- `getById(id: number): MemoryRow | undefined`
- `getUnconsolidated(): MemoryRow[]`
- `markConsolidated(ids: number[]): void`
- `updateConnections(id: number, connections: ConnectionEntry[]): void`
- `deleteById(id: number): boolean`
- `deleteAll(): number`
- `getStats(): MemoryStats`

**ConsolidationRepository** -- 4 methods:
- `insert(consolidation: NewConsolidation): ConsolidationRow`
- `getAll(): ConsolidationRow[]`
- `deleteAll(): number`
- `getCount(): number`

**ProcessedFileRepository** -- 3 methods:
- `isProcessed(filePath: string): boolean`
- `markProcessed(filePath: string): void`
- `getAll(): ProcessedFileRow[]`

### Connection management (`src/database/connection.ts`)

- `initializeDatabase(dbPath: string): Database.Database` -- opens SQLite, sets WAL, runs DDL
- `closeDatabase(db: Database.Database): void`

### Schema (`src/database/schema.ts`)

- 3 tables: `Memory`, `Consolidation`, `ProcessedFile`
- 4 indexes on userId, consolidated, importance
- SQLite-specific DDL (AUTOINCREMENT, INTEGER, etc.)

### Data types (`src/database/types.ts`)

- `MemoryRow`, `NewMemory`, `ConsolidationRow`, `NewConsolidation`, `ProcessedFileRow`, `ConnectionEntry`, `MemoryStats`
- JSON fields stored as serialized strings (entities, topics, connections, sourceIds)

### What changes

- **New**: Define interfaces `IMemoryRepository`, `IConsolidationRepository`, `IProcessedFileRepository` matching the method signatures above
- **New**: `StorageFactory` that reads `storage-config.yaml` and returns the correct backend
- **Refactor**: Rename existing classes to `SqliteMemoryRepository`, etc., implementing the new interfaces
- **New**: `SqlServerMemoryRepository`, `SqlServerConsolidationRepository`, `SqlServerProcessedFileRepository`
- **New**: `AzureBlobMemoryRepository`, `AzureBlobConsolidationRepository`, `AzureBlobProcessedFileRepository`
- **Data types stay**: `MemoryRow`, `ConsolidationRow`, `ProcessedFileRow`, etc. are backend-agnostic and remain unchanged
- **connection.ts / schema.ts**: Become SQLite-specific; SQL Server and Azure Blob get their own init logic

### Files affected

| File | Change |
|------|--------|
| `src/database/types.ts` | Add repository interfaces; existing row types unchanged |
| `src/database/memory-repository.ts` | Rename class, implement interface |
| `src/database/consolidation-repository.ts` | Rename class, implement interface |
| `src/database/processed-file-repository.ts` | Rename class, implement interface |
| `src/database/connection.ts` | Becomes SQLite-specific init |
| `src/database/schema.ts` | Becomes SQLite-specific DDL |
| `src/database/index.ts` | Export interfaces, factory, all backends |
| **New files** | Storage factory, SQL Server repos, Azure Blob repos, SQL Server schema/connection, Azure Blob connection |

---

## 4. Current LLM Pattern

### Provider Factory (`src/llm/provider-factory.ts`)

```typescript
function createLlm(config: AppConfig): BaseChatModel
```

- Switches on `config.llmProvider`
- Creates `ChatOpenAI`, `ChatAnthropic`, or `ChatGoogleGenerativeAI`
- Hardcoded `temperature: 0` for all providers
- Takes only `apiKey` and `model` from config

### What changes

- Accept new `LlmConfig` type instead of `AppConfig`
- Read `temperature` from YAML (currently hardcoded to 0)
- Pass optional `organization`, `baseUrl` when present
- Signature becomes: `createLlm(llmConfig: LlmConfig): BaseChatModel`

### Files affected

| File | Change |
|------|--------|
| `src/llm/provider-factory.ts` | New parameter type, temperature from config, optional fields |
| `src/llm/index.ts` | Minor barrel update if types change |

---

## 5. Integration Points (src/index.ts)

The entry point wires everything in sequence:

```
1. loadConfig()           -> AppConfig
2. initializeDatabase()   -> Database.Database
3. new MemoryRepository(db), new ConsolidationRepository(db), new ProcessedFileRepository(db)
4. createLlm(config)      -> BaseChatModel
5. new IngestAgent(llm, memoryRepo)
6. new ConsolidateAgent(llm, memoryRepo, consolidationRepo)
7. new QueryAgent(llm, memoryRepo, consolidationRepo)
8. createServer({agents, repos}) -> Fastify
9. new FileWatcher(watchDir, ingestAgent, processedFileRepo)
10. new ConsolidationLoop(consolidateAgent, intervalMs)
11. Signal handlers for graceful shutdown (closeDatabase)
```

### What changes in index.ts

- Step 1: `loadConfig()` returns restructured `AppConfig` with nested storage/llm config
- Step 2: Replace `initializeDatabase(config.databasePath)` with `StorageFactory.create(config.storage)` returning all three repository instances
- Step 3: Repositories come from factory, not manual construction
- Step 4: `createLlm(config.llm)` instead of `createLlm(config)`
- Step 11: Shutdown must call backend-specific cleanup (not just `closeDatabase`)

---

## 6. Consumer Dependencies on Repositories

These modules import repository **classes** directly (will need to switch to **interfaces**):

| Consumer | Uses |
|----------|------|
| `IngestAgent` | `MemoryRepository` (constructor param, calls `insert`) |
| `ConsolidateAgent` | `MemoryRepository` (calls `getUnconsolidated`, `markConsolidated`), `ConsolidationRepository` (calls `insert`) |
| `QueryAgent` | `MemoryRepository` (calls `getAll`), `ConsolidationRepository` (calls `getAll`) |
| `FileWatcher` | `ProcessedFileRepository` (calls `isProcessed`, `markProcessed`) |
| `routes.ts` | `MemoryRepository` (calls `getAll`, `getStats`, `deleteById`, `deleteAll`), `ConsolidationRepository` (calls `deleteAll`) |
| `api/types.ts` | References `MemoryRepository`, `ConsolidationRepository` in `ServerDependencies` |

All imports reference the concrete class type. After introducing interfaces, these must reference `IMemoryRepository`, `IConsolidationRepository`, `IProcessedFileRepository` instead.

---

## 7. Patterns to Preserve

1. **No defaults, no fallbacks** -- All required config must be explicitly provided or throw at startup
2. **Repository pattern** -- Methods return plain row types (`MemoryRow`, etc.), not ORM entities
3. **Synchronous repository methods** -- Current SQLite repos are all synchronous. New backends (SQL Server, Azure Blob) will be async. The interfaces must use `Promise<T>` return types, and all consumers must be updated to `await`
4. **Prepared statements** -- SQLite backend uses prepared statements; this should continue
5. **Transaction support** -- `markConsolidated` uses a transaction; interface should support atomic batch ops
6. **Barrel exports** -- Each module exposes a clean public API via `index.ts`
7. **Exhaustive switch** -- `provider-factory.ts` uses `never` for exhaustive provider checking
8. **Graceful shutdown** -- Entry point handles SIGINT/SIGTERM with ordered cleanup

---

## 8. Key Architectural Decisions for Implementation

1. **Sync-to-Async migration**: The biggest cross-cutting change. Current repos are synchronous (better-sqlite3 is synchronous). SQL Server (`mssql`) and Azure Blob (`@azure/storage-blob`) are async. All repository interfaces must be `async` (return `Promise`), and all 6 consumers must be updated to `await` calls.

2. **Interface location**: Repository interfaces should live in `src/database/types.ts` alongside the row types they reference, keeping the single source of truth.

3. **Factory return type**: `StorageFactory.create()` should return a bundle: `{ memoryRepo: IMemoryRepository, consolidationRepo: IConsolidationRepository, processedFileRepo: IProcessedFileRepository, close(): Promise<void> }`.

4. **New npm dependencies needed**: `js-yaml`, `@types/js-yaml`, `mssql`, `@types/mssql`, `@azure/storage-blob`.

5. **File organization**: Consider grouping backends under `src/database/sqlite/`, `src/database/sqlserver/`, `src/database/azure-blob/` to keep the directory manageable.

---

## 9. Summary of All Files Affected

| Priority | File | Type of Change |
|----------|------|----------------|
| HIGH | `src/config/types.ts` | Restructure AppConfig |
| HIGH | `src/config/config.ts` | YAML loading |
| HIGH | `src/config/validation.ts` | YAML validation |
| HIGH | `src/database/types.ts` | Add repository interfaces |
| HIGH | `src/database/memory-repository.ts` | Implement interface, async |
| HIGH | `src/database/consolidation-repository.ts` | Implement interface, async |
| HIGH | `src/database/processed-file-repository.ts` | Implement interface, async |
| HIGH | `src/index.ts` | New wiring with factory |
| HIGH | `src/llm/provider-factory.ts` | New config shape, temperature, optional fields |
| MEDIUM | `src/agents/ingest-agent.ts` | Await repo calls, use interface type |
| MEDIUM | `src/agents/consolidate-agent.ts` | Await repo calls, use interface type |
| MEDIUM | `src/agents/query-agent.ts` | Await repo calls, use interface type |
| MEDIUM | `src/api/routes.ts` | Await repo calls |
| MEDIUM | `src/api/types.ts` | Use interface types in ServerDependencies |
| MEDIUM | `src/watcher/file-watcher.ts` | Await repo calls |
| LOW | `src/database/index.ts` | Updated barrel exports |
| LOW | `src/config/index.ts` | Updated barrel exports |
| LOW | `src/llm/index.ts` | Updated barrel exports |
| NEW | `src/database/storage-factory.ts` | StorageFactory |
| NEW | `src/database/sqlite/*` | Refactored SQLite backend |
| NEW | `src/database/sqlserver/*` | SQL Server backend |
| NEW | `src/database/azure-blob/*` | Azure Blob backend |
