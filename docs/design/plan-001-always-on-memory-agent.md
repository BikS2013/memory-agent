# Plan 001: Always-On Memory Agent - Implementation Plan

**Created**: 2026-03-09
**Type**: Greenfield TypeScript Project
**Development Mode**: Solo agentic development with incremental verification

---

## Overview

This plan breaks the implementation of the TypeScript Always-On Memory Agent into 7 discrete phases, each with clear deliverables, verification steps, and acceptance criteria. Phases are ordered by dependency -- each phase builds on the previous one.

The project implements a persistent memory system that processes, consolidates, and connects user preference information, inspired by Google's Always-On Memory Agent. It is designed to be consumed by other agents in the platform.

---

## Phase 1: Project Scaffolding and Configuration

**Objective**: Set up the TypeScript project with strict configuration, ESM modules, build pipeline, and the configuration management layer that raises exceptions for missing values.

**Dependencies**: None (starting point)

### Files to Create

| File | Purpose |
|------|---------|
| `package.json` | Project manifest with ESM, scripts, engines |
| `tsconfig.json` | Strict TypeScript config, ES2022, NodeNext |
| `.gitignore` | Ignore dist/, node_modules/, *.db, .env |
| `src/config/config.ts` | Configuration loader -- reads env vars, throws on missing |
| `src/config/types.ts` | AppConfig interface definition |
| `src/config/validation.ts` | Validation logic -- ensure all required params present |
| `src/index.ts` | Minimal entry point (just loads config and logs) |

### Configuration Parameters (all required, no fallbacks)

| Parameter | Env Variable | Description |
|-----------|-------------|-------------|
| `llmProvider` | `LLM_PROVIDER` | Provider name: "openai", "anthropic", "google" |
| `llmModel` | `LLM_MODEL` | Model identifier (e.g., "gpt-4", "claude-sonnet-4") |
| `llmApiKey` | `LLM_API_KEY` | API key for the selected provider |
| `databasePath` | `DATABASE_PATH` | Path to SQLite database file |
| `watchDirectory` | `WATCH_DIRECTORY` | Path to inbox directory for file watching |
| `apiPort` | `API_PORT` | HTTP server port number |
| `consolidationIntervalMs` | `CONSOLIDATION_INTERVAL_MS` | Consolidation loop interval in milliseconds |

### Steps

1. Initialize project: `npm init` with `"type": "module"`
2. Install core dev dependencies: `typescript`, `tsx`, `@types/node`, `vitest`
3. Create `tsconfig.json` with strict mode, ES2022 target, NodeNext modules
4. Create `src/config/types.ts` with the `AppConfig` interface
5. Create `src/config/validation.ts` -- each missing config parameter throws `Error` with a clear message naming the missing variable
6. Create `src/config/config.ts` -- reads from `process.env`, calls validation, exports loaded config
7. Create `src/index.ts` -- loads config, logs startup
8. Create `.gitignore`

### Verification

```bash
# Must compile without errors
npx tsc --noEmit

# Must fail with clear error when env vars are missing
npx tsx src/index.ts
# Expected: Error thrown naming the first missing config variable

# Must succeed when all env vars are provided
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=test-key \
DATABASE_PATH=./test.db WATCH_DIRECTORY=./inbox API_PORT=8888 \
CONSOLIDATION_INTERVAL_MS=1800000 npx tsx src/index.ts
# Expected: Successful startup log, clean exit
```

### Acceptance Criteria

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Missing any single env var produces a clear exception naming the variable
- [ ] All seven config parameters are loaded and accessible via typed `AppConfig`
- [ ] Project uses ESM (`"type": "module"` in package.json)
- [ ] TypeScript strict mode is enabled

---

## Phase 2: Database Layer

**Objective**: Implement SQLite persistence with better-sqlite3, create the three tables (Memory, Consolidation, ProcessedFile) with singular names, and build repository modules for each table.

**Dependencies**: Phase 1 (config provides `databasePath`)

### Files to Create

| File | Purpose |
|------|---------|
| `src/database/database.ts` | Database initialization, schema creation, connection management |
| `src/database/schema.ts` | SQL DDL statements for all tables and indexes |
| `src/database/types.ts` | TypeScript interfaces for Memory, Consolidation, ProcessedFile rows |
| `src/database/repositories/memory-repository.ts` | CRUD for Memory table |
| `src/database/repositories/consolidation-repository.ts` | CRUD for Consolidation table |
| `src/database/repositories/processed-file-repository.ts` | CRUD for ProcessedFile table |
| `src/database/index.ts` | Barrel export |

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS Memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL DEFAULT 'default',
    source TEXT NOT NULL DEFAULT '',
    rawText TEXT NOT NULL,
    summary TEXT NOT NULL,
    entities TEXT NOT NULL DEFAULT '[]',
    topics TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5,
    consolidated INTEGER NOT NULL DEFAULT 0,
    connections TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Consolidation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL DEFAULT 'default',
    sourceIds TEXT NOT NULL,
    summary TEXT NOT NULL,
    insight TEXT NOT NULL,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProcessedFile (
    path TEXT PRIMARY KEY,
    processedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_user ON Memory(userId);
CREATE INDEX IF NOT EXISTS idx_memory_consolidated ON Memory(consolidated);
CREATE INDEX IF NOT EXISTS idx_consolidation_user ON Consolidation(userId);
```

### Repository Methods

**MemoryRepository**:
- `insert(memory: NewMemory): MemoryRow` -- insert and return with id
- `getAll(): MemoryRow[]` -- all memories
- `getById(id: number): MemoryRow | undefined`
- `getUnconsolidated(): MemoryRow[]` -- where consolidated = 0
- `markConsolidated(ids: number[]): void` -- set consolidated = 1
- `deleteById(id: number): boolean`
- `deleteAll(): void`
- `getStats(): { total: number; consolidated: number }`

**ConsolidationRepository**:
- `insert(consolidation: NewConsolidation): ConsolidationRow`
- `getAll(): ConsolidationRow[]`
- `deleteAll(): void`
- `getCount(): number`

**ProcessedFileRepository**:
- `isProcessed(path: string): boolean`
- `markProcessed(path: string): void`
- `getAll(): ProcessedFileRow[]`

### Steps

1. Install `better-sqlite3` and `@types/better-sqlite3`
2. Create `src/database/types.ts` with row interfaces (`MemoryRow`, `ConsolidationRow`, `ProcessedFileRow`) and insert types (`NewMemory`, `NewConsolidation`)
3. Create `src/database/schema.ts` with DDL constants
4. Create `src/database/database.ts` -- initializes DB, runs schema, exports `getDatabase()` function
5. Create the three repository files with prepared statements
6. Create `src/database/index.ts` barrel export
7. Write integration test: `tests/database/database.test.ts`

### Verification

```bash
# Type check
npx tsc --noEmit

# Run database tests
npx vitest run tests/database/

# Manual verification: insert a memory, query it, delete it
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=test \
DATABASE_PATH=./test-verify.db WATCH_DIRECTORY=./inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 \
npx tsx tests/database/database.test.ts
```

### Acceptance Criteria

- [ ] All three tables created with correct schema (singular names)
- [ ] `userId` field present in Memory and Consolidation tables
- [ ] MemoryRepository: insert, getAll, getById, getUnconsolidated, markConsolidated, deleteById, deleteAll, getStats all work
- [ ] ConsolidationRepository: insert, getAll, deleteAll, getCount all work
- [ ] ProcessedFileRepository: isProcessed, markProcessed, getAll all work
- [ ] JSON fields (entities, topics, connections, sourceIds) stored as TEXT and parsed correctly
- [ ] Indexes created for userId and consolidated columns
- [ ] `npx tsc --noEmit` passes

---

## Phase 3: LLM Integration Layer

**Objective**: Implement the LangChain.js abstraction layer with provider factory, Zod schemas for structured output, and the three agent implementations (IngestAgent, ConsolidateAgent, QueryAgent).

**Dependencies**: Phase 1 (config), Phase 2 (database repositories)

### Files to Create

| File | Purpose |
|------|---------|
| `src/llm/provider-factory.ts` | Creates LangChain model instance based on config (provider + model + apiKey) |
| `src/llm/schemas.ts` | Zod schemas: MemoryExtraction, ConsolidationResult, QueryResult |
| `src/llm/types.ts` | TypeScript types for LLM inputs/outputs |
| `src/llm/index.ts` | Barrel export |
| `src/agents/ingest-agent.ts` | IngestAgent: processes text, extracts metadata via LLM, stores in DB |
| `src/agents/consolidate-agent.ts` | ConsolidateAgent: reads unconsolidated memories, finds patterns via LLM, stores consolidation |
| `src/agents/query-agent.ts` | QueryAgent: retrieves memories + consolidations, synthesizes answer via LLM |
| `src/agents/prompts.ts` | System prompts for each agent (user-preference-tuned) |
| `src/agents/types.ts` | Agent input/output types |
| `src/agents/index.ts` | Barrel export |

### Zod Schemas

```typescript
// Memory extraction (IngestAgent output)
const MemoryExtractionSchema = z.object({
  summary: z.string(),
  entities: z.array(z.string()),
  topics: z.array(z.string()),
  importance: z.number().min(0).max(1),
});

// Consolidation result (ConsolidateAgent output)
const ConsolidationResultSchema = z.object({
  summary: z.string(),
  insight: z.string(),
  connections: z.array(z.object({
    fromId: z.number(),
    toId: z.number(),
    relationship: z.string(),
  })),
});

// Query result (QueryAgent output)
const QueryResultSchema = z.object({
  answer: z.string(),
  sourceMemoryIds: z.array(z.number()),
  confidence: z.string(),
});
```

### Provider Factory Logic

The factory must:
1. Read `llmProvider`, `llmModel`, `llmApiKey` from config
2. Instantiate the correct LangChain chat model class
3. Supported providers: `openai` -> `ChatOpenAI`, `anthropic` -> `ChatAnthropic`, `google` -> `ChatGoogleGenerativeAI`
4. Throw if provider is not recognized

### Steps

1. Install LangChain packages: `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, `zod`
2. Create `src/llm/schemas.ts` with Zod schemas
3. Create `src/llm/types.ts`
4. Create `src/llm/provider-factory.ts` -- factory function `createLLM(config): BaseChatModel`
5. Create `src/agents/prompts.ts` -- user-preference-tuned system prompts for all three agents
6. Create `src/agents/ingest-agent.ts`:
   - Takes raw text + source
   - Calls LLM with structured output (MemoryExtractionSchema)
   - Stores result via MemoryRepository
   - Returns the stored memory
7. Create `src/agents/consolidate-agent.ts`:
   - Reads unconsolidated memories
   - If < 2, returns early
   - Calls LLM with all unconsolidated memories to find patterns
   - Stores consolidation via ConsolidationRepository
   - Marks memories as consolidated
   - Updates memory connections
8. Create `src/agents/query-agent.ts`:
   - Reads all memories and consolidations
   - Calls LLM with question + context
   - Returns structured answer with citations
9. Create barrel exports

### Verification

```bash
# Type check
npx tsc --noEmit

# Verify provider factory instantiation (no actual LLM call)
# Write a small test that creates provider instances for each supported type
npx vitest run tests/llm/

# Integration test with real LLM (requires valid API key)
# Ingest a sample preference, verify structured output
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=$OPENAI_API_KEY \
DATABASE_PATH=./test-llm.db WATCH_DIRECTORY=./inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 \
npx tsx test_scripts/test-ingest.ts
```

### Acceptance Criteria

- [ ] Provider factory creates correct LangChain model for openai, anthropic, google
- [ ] Provider factory throws for unknown provider name
- [ ] IngestAgent extracts summary, entities, topics, importance from text via LLM
- [ ] IngestAgent stores extracted data in Memory table
- [ ] ConsolidateAgent skips when < 2 unconsolidated memories
- [ ] ConsolidateAgent produces consolidation records linking related memories
- [ ] ConsolidateAgent marks processed memories as consolidated
- [ ] QueryAgent returns answer with source memory ID citations
- [ ] All Zod schemas validate LLM output correctly
- [ ] System prompts are tuned for user preference extraction
- [ ] `npx tsc --noEmit` passes

---

## Phase 4: HTTP API

**Objective**: Implement the Fastify HTTP server with all required REST endpoints.

**Dependencies**: Phase 1 (config for port), Phase 2 (database), Phase 3 (agents)

### Files to Create

| File | Purpose |
|------|---------|
| `src/api/server.ts` | Fastify server creation and configuration |
| `src/api/routes/memory-routes.ts` | Routes: GET /memories, POST /ingest, POST /delete, POST /clear |
| `src/api/routes/query-routes.ts` | Routes: GET /query |
| `src/api/routes/status-routes.ts` | Routes: GET /status, POST /consolidate |
| `src/api/types.ts` | Request/response type definitions |
| `src/api/index.ts` | Barrel export |

### Endpoints

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `GET` | `/status` | System status and stats | - | `{ status, memories, consolidated, consolidations }` |
| `GET` | `/memories` | List all memories | - | `{ memories: MemoryRow[] }` |
| `GET` | `/query` | Query memories | `?q=<question>` | `{ answer, sources, confidence }` |
| `POST` | `/ingest` | Ingest new text | `{ text, source? }` | `{ status, memory }` |
| `POST` | `/consolidate` | Trigger consolidation | - | `{ status, consolidation? }` |
| `POST` | `/delete` | Delete a memory | `{ id }` | `{ status, deleted }` |
| `POST` | `/clear` | Clear all memories | - | `{ status, cleared }` |

### Steps

1. Install `fastify`
2. Create `src/api/types.ts` with request/response interfaces
3. Create `src/api/routes/status-routes.ts` -- registers GET /status
4. Create `src/api/routes/memory-routes.ts` -- registers GET /memories, POST /ingest, POST /delete, POST /clear
5. Create `src/api/routes/query-routes.ts` -- registers GET /query
6. Create `src/api/server.ts` -- creates Fastify instance, registers all route plugins, exports `createServer()` and `startServer()`
7. Update `src/index.ts` to start the HTTP server
8. Add Fastify schema validation on POST /ingest (requires `text` field) and POST /delete (requires `id` field)

### Verification

```bash
# Type check
npx tsc --noEmit

# Start server and test endpoints with curl
# Terminal 1: Start the server
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=$OPENAI_API_KEY \
DATABASE_PATH=./test-api.db WATCH_DIRECTORY=./inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 \
npx tsx src/index.ts

# Terminal 2: Test endpoints
curl http://localhost:8888/status
curl -X POST http://localhost:8888/ingest -H "Content-Type: application/json" \
  -d '{"text": "User prefers dark mode in all applications", "source": "test"}'
curl http://localhost:8888/memories
curl "http://localhost:8888/query?q=What%20are%20the%20user%27s%20UI%20preferences?"
curl -X POST http://localhost:8888/consolidate
curl -X POST http://localhost:8888/delete -H "Content-Type: application/json" -d '{"id": 1}'
curl -X POST http://localhost:8888/clear
```

### Acceptance Criteria

- [ ] GET /status returns memory statistics
- [ ] POST /ingest accepts text, processes via IngestAgent, returns stored memory
- [ ] POST /ingest returns 400 if `text` field is missing
- [ ] GET /memories returns all stored memories
- [ ] GET /query accepts `q` parameter and returns synthesized answer
- [ ] POST /consolidate triggers consolidation and returns result
- [ ] POST /delete removes a memory by ID
- [ ] POST /clear removes all memories and consolidations
- [ ] Server starts on configured port
- [ ] `npx tsc --noEmit` passes

---

## Phase 5: File Watcher

**Objective**: Implement the Chokidar-based file watcher that monitors an inbox directory, auto-ingests supported files, and tracks processed files to prevent re-ingestion.

**Dependencies**: Phase 1 (config for watchDirectory), Phase 2 (ProcessedFileRepository), Phase 3 (IngestAgent)

### Files to Create

| File | Purpose |
|------|---------|
| `src/watcher/file-watcher.ts` | Chokidar watcher setup, event handling, lifecycle |
| `src/watcher/processors/text-processor.ts` | Read file content based on extension |
| `src/watcher/types.ts` | Supported extensions, watcher options |
| `src/watcher/index.ts` | Barrel export |

### Supported File Extensions

`.txt`, `.md`, `.json`, `.csv`, `.yaml`, `.yml`, `.xml`

### Logic

1. On startup, create inbox directory if it does not exist
2. Initialize Chokidar watcher on the inbox directory
3. On `add` event:
   a. Check file extension is supported
   b. Check ProcessedFileRepository -- skip if already processed
   c. Read file content via text-processor
   d. Call IngestAgent with content and file path as source
   e. Mark file as processed in ProcessedFileRepository
4. Log all watcher events (add, error)
5. Provide `start()` and `stop()` lifecycle methods

### Steps

1. Install `chokidar@4`
2. Create `src/watcher/types.ts` -- supported extensions array
3. Create `src/watcher/processors/text-processor.ts` -- reads file content as UTF-8, handles JSON/YAML/CSV formatting
4. Create `src/watcher/file-watcher.ts` -- Chokidar setup, event handlers, deduplication via ProcessedFileRepository
5. Update `src/index.ts` to start the file watcher alongside the HTTP server

### Verification

```bash
# Type check
npx tsc --noEmit

# Start the system
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=$OPENAI_API_KEY \
DATABASE_PATH=./test-watcher.db WATCH_DIRECTORY=./test-inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 \
npx tsx src/index.ts

# Drop a file into the inbox
echo "User prefers TypeScript over JavaScript for all projects" > ./test-inbox/pref1.txt

# Verify ingestion (within 10 seconds)
curl http://localhost:8888/memories
# Expected: Memory with the file content

# Drop the same file again (rename and re-add)
cp ./test-inbox/pref1.txt ./test-inbox/pref1-copy.txt
# Expected: pref1-copy.txt is ingested, pref1.txt is NOT re-ingested

# Drop an unsupported file
echo "binary" > ./test-inbox/file.bin
# Expected: Ignored, not ingested
```

### Acceptance Criteria

- [ ] Watcher detects new files in the inbox directory within 10 seconds
- [ ] Supported extensions (.txt, .md, .json, .csv, .yaml, .yml, .xml) are ingested
- [ ] Unsupported extensions are ignored
- [ ] Already-processed files are not re-ingested
- [ ] File path is recorded as `source` in the Memory record
- [ ] Watcher creates inbox directory if it does not exist
- [ ] Watcher has clean start/stop lifecycle
- [ ] `npx tsc --noEmit` passes

---

## Phase 6: Consolidation Loop

**Objective**: Implement the background timer that periodically triggers the ConsolidateAgent to process unconsolidated memories.

**Dependencies**: Phase 1 (config for interval), Phase 3 (ConsolidateAgent)

### Files to Create

| File | Purpose |
|------|---------|
| `src/consolidation/consolidation-loop.ts` | Timer-based loop that calls ConsolidateAgent at configured interval |
| `src/consolidation/types.ts` | Loop configuration types |
| `src/consolidation/index.ts` | Barrel export |

### Logic

1. On startup, start a `setInterval` timer at `consolidationIntervalMs`
2. Each tick:
   a. Call ConsolidateAgent
   b. Log result (consolidated or skipped)
   c. Handle errors gracefully (log and continue, do not crash)
3. Provide `start()` and `stop()` lifecycle methods
4. `stop()` clears the interval timer

### Steps

1. Create `src/consolidation/types.ts`
2. Create `src/consolidation/consolidation-loop.ts`
3. Update `src/index.ts` to start the consolidation loop

### Verification

```bash
# Type check
npx tsc --noEmit

# Start with short interval for testing (10 seconds)
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=$OPENAI_API_KEY \
DATABASE_PATH=./test-consolidation.db WATCH_DIRECTORY=./test-inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=10000 \
npx tsx src/index.ts

# Ingest 3 memories
curl -X POST http://localhost:8888/ingest -H "Content-Type: application/json" \
  -d '{"text": "User prefers dark mode", "source": "test"}'
curl -X POST http://localhost:8888/ingest -H "Content-Type: application/json" \
  -d '{"text": "User likes minimal UI with no clutter", "source": "test"}'
curl -X POST http://localhost:8888/ingest -H "Content-Type: application/json" \
  -d '{"text": "User wants compact layouts in all tools", "source": "test"}'

# Wait 15 seconds for consolidation loop to run
sleep 15

# Check status
curl http://localhost:8888/status
# Expected: consolidations > 0
```

### Acceptance Criteria

- [ ] Consolidation loop runs at configured interval
- [ ] Loop calls ConsolidateAgent each tick
- [ ] Loop handles errors without crashing
- [ ] Loop has clean start/stop lifecycle
- [ ] After ingesting 3+ memories and waiting for a tick, at least one consolidation is created
- [ ] `npx tsc --noEmit` passes

---

## Phase 7: Client SDK and Application Lifecycle

**Objective**: Implement the client library for agent integration, wire up graceful startup/shutdown, and finalize the application entry point. Document all tools in CLAUDE.md.

**Dependencies**: Phase 4 (HTTP API must be running for client to connect)

### Files to Create

| File | Purpose |
|------|---------|
| `src/client/memory-client.ts` | Client SDK with `ingest()`, `query()`, `getPreferences()` methods |
| `src/client/types.ts` | Client configuration and response types |
| `src/client/index.ts` | Barrel export |
| `CLAUDE.md` | Project-level Claude instructions and tool documentation |
| `Issues - Pending Items.md` | Issue tracker per project conventions |

### Client SDK Interface

```typescript
class MemoryClient {
  constructor(options: { baseUrl: string });

  // Ingest a preference or information
  async ingest(text: string, source?: string): Promise<IngestResponse>;

  // Query memories with a natural language question
  async query(question: string): Promise<QueryResponse>;

  // Get preferences filtered by category/topic
  async getPreferences(category?: string): Promise<PreferencesResponse>;

  // Get system status
  async getStatus(): Promise<StatusResponse>;
}
```

### Application Lifecycle (src/index.ts)

```
Startup sequence:
1. Load and validate configuration (throw on missing)
2. Initialize database (create tables if needed)
3. Create LLM provider instance
4. Create agent instances (Ingest, Consolidate, Query)
5. Start HTTP server
6. Start file watcher
7. Start consolidation loop
8. Log "System ready" with configuration summary

Shutdown sequence (SIGINT, SIGTERM):
1. Stop consolidation loop
2. Stop file watcher
3. Close HTTP server
4. Close database connection
5. Log "System shutdown complete"
6. Exit cleanly
```

### Steps

1. Create `src/client/types.ts` -- client config and response types
2. Create `src/client/memory-client.ts` -- HTTP client using native `fetch` (Node.js 18+ built-in)
3. Create `src/client/index.ts` -- barrel export
4. Update `src/index.ts` with full startup/shutdown sequence and signal handlers
5. Create `CLAUDE.md` with project instructions and tool documentation
6. Create `Issues - Pending Items.md`
7. Write integration test: `test_scripts/test-client-sdk.ts`

### Verification

```bash
# Type check
npx tsc --noEmit

# Full build
npx tsc

# Start the application
LLM_PROVIDER=openai LLM_MODEL=gpt-4 LLM_API_KEY=$OPENAI_API_KEY \
DATABASE_PATH=./memory.db WATCH_DIRECTORY=./inbox \
API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 \
node dist/index.js

# Test client SDK from another script
npx tsx test_scripts/test-client-sdk.ts
# Expected: Successfully calls ingest(), query(), getPreferences()

# Test graceful shutdown
kill -SIGINT <pid>
# Expected: Clean shutdown log, no errors

# Test missing config
node dist/index.js
# Expected: Clear error about missing config, exit code 1
```

### Acceptance Criteria

- [ ] Client SDK can be imported as a TypeScript module
- [ ] `ingest()` sends text to the server and returns the stored memory
- [ ] `query()` sends a question and returns a synthesized answer with sources
- [ ] `getPreferences()` returns memories filtered by category
- [ ] `getStatus()` returns system statistics
- [ ] Application starts all subsystems in correct order
- [ ] Application handles SIGINT/SIGTERM with clean shutdown
- [ ] Missing config at startup produces clear error and exit
- [ ] `CLAUDE.md` documents all tools in XML format
- [ ] `npx tsc --noEmit` passes
- [ ] `npx tsc` produces working dist/ output
- [ ] `node dist/index.js` runs the full application

---

## Dependency Graph

```
Phase 1: Scaffolding & Config
    |
    v
Phase 2: Database Layer --------+
    |                            |
    v                            |
Phase 3: LLM & Agents ----------+-------+
    |           |                |       |
    v           |                |       |
Phase 4: HTTP API               |       |
    |                            v       v
    |              Phase 5: File Watcher |
    |                                    v
    |                    Phase 6: Consolidation Loop
    |                            |
    v                            v
Phase 7: Client SDK & Lifecycle (depends on all above)
```

### Parallelization Opportunities

- **Phases 4, 5, 6** can be developed in parallel after Phase 3 completes, as they depend on agents/database but not on each other
- Within Phase 3, the provider factory and Zod schemas can be built before the agent implementations
- Within Phase 2, the schema/types can be built before the repositories

---

## Complete File Manifest

```
always-memory-on/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── config.ts
│   │   ├── validation.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── database/
│   │   ├── database.ts
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   ├── index.ts
│   │   └── repositories/
│   │       ├── memory-repository.ts
│   │       ├── consolidation-repository.ts
│   │       └── processed-file-repository.ts
│   ├── llm/
│   │   ├── provider-factory.ts
│   │   ├── schemas.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── agents/
│   │   ├── ingest-agent.ts
│   │   ├── consolidate-agent.ts
│   │   ├── query-agent.ts
│   │   ├── prompts.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── api/
│   │   ├── server.ts
│   │   ├── types.ts
│   │   ├── index.ts
│   │   └── routes/
│   │       ├── memory-routes.ts
│   │       ├── query-routes.ts
│   │       └── status-routes.ts
│   ├── watcher/
│   │   ├── file-watcher.ts
│   │   ├── types.ts
│   │   ├── index.ts
│   │   └── processors/
│   │       └── text-processor.ts
│   ├── consolidation/
│   │   ├── consolidation-loop.ts
│   │   ├── types.ts
│   │   └── index.ts
│   └── client/
│       ├── memory-client.ts
│       ├── types.ts
│       └── index.ts
├── tests/
│   ├── database/
│   │   └── database.test.ts
│   ├── llm/
│   │   └── provider-factory.test.ts
│   └── integration/
│       └── full-flow.test.ts
├── test_scripts/
│   ├── test-ingest.ts
│   └── test-client-sdk.ts
├── docs/
│   ├── design/
│   │   ├── plan-001-always-on-memory-agent.md
│   │   ├── project-design.md
│   │   └── project-functions.md
│   └── reference/
│       ├── refined-request-always-on-memory-agent.md
│       └── investigation-always-on-memory-agent.md
├── package.json
├── tsconfig.json
├── .gitignore
├── CLAUDE.md
└── Issues - Pending Items.md
```

**Total files to create**: ~42

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **LLM structured output fails** for some providers | Medium | High | Use LangChain's `withStructuredOutput()` which handles provider differences. Add fallback parsing with JSON.parse if structured output mode is unsupported. Test with at least 2 providers. |
| **better-sqlite3 native compilation fails** on target platform | Low | High | better-sqlite3 has prebuilt binaries for major platforms. If compilation fails, fallback to `sql.js` (WASM-based, no native deps). |
| **Chokidar misses file events** on specific OS | Low | Medium | Chokidar v4 is battle-tested on all major OS. Add a startup scan of existing files in inbox as a safety net. |
| **LLM API rate limits** during consolidation of many memories | Medium | Medium | Add retry logic with exponential backoff in agent calls. Batch memories in chunks if the context window is too small. |
| **Large memory counts degrade query performance** (>50 memories) | Medium | Medium | The QueryAgent reads all memories into context. If this becomes a problem, add pagination or topic-based filtering before sending to LLM. Monitor context window usage. |
| **ESM/CJS module compatibility issues** with dependencies | Low | Medium | Use `NodeNext` module resolution. Test all imports early. Some packages may need `import()` dynamic imports. |
| **Configuration drift** between dev/prod environments | Low | Low | Strict no-fallback policy ensures errors surface immediately. Document all env vars clearly. |

---

## Estimated Effort (Solo Development)

| Phase | Estimated Time | Notes |
|-------|---------------|-------|
| Phase 1: Scaffolding | 1-2 hours | Straightforward setup |
| Phase 2: Database | 2-3 hours | Schema + 3 repositories + tests |
| Phase 3: LLM & Agents | 3-4 hours | Most complex -- LLM integration + 3 agents + prompts |
| Phase 4: HTTP API | 2-3 hours | 7 endpoints with validation |
| Phase 5: File Watcher | 1-2 hours | Chokidar setup + processor |
| Phase 6: Consolidation Loop | 1 hour | Timer + error handling |
| Phase 7: Client SDK & Lifecycle | 2-3 hours | SDK + shutdown + documentation |
| **Total** | **12-18 hours** | |

---

## Post-Phase 1 Considerations (Phase 2 - Dashboard)

These items are explicitly deferred and not part of this plan:

1. **Dashboard UI** -- Web-based visualization of memories, consolidations, and statistics
2. **Multi-tenancy enforcement** -- userId-based data isolation and authentication
3. **Memory retention policies** -- Age-based or count-based cleanup
4. **Vector search** -- Embedding-based similarity search for better query relevance at scale
5. **WebSocket real-time updates** -- Live memory feed for dashboard
