# Issues - Pending Items

## Pending Items

### P10 - validateConfig() is exported but never called
**Severity**: Low
**Location**: `src/config/validation.ts` (line 13), `src/config/index.ts` (not exported)
**Description**: The `validateConfig()` function validates `AppConfig` fields (watchDirectory, apiPort, consolidationIntervalMs), but it is never imported or called anywhere in the codebase. The `loadConfig()` function in `config.ts` already performs equivalent inline validation for these fields before returning the config object. This makes `validateConfig()` dead code. It should either be called after `loadConfig()` as a defense-in-depth measure, removed entirely, or at minimum not confuse future maintainers.

### P11 - Azure Blob ID generation is not globally atomic across time-period blobs
**Severity**: Medium
**Location**: `src/database/azure-blob/azure-blob-memory-repository.ts` (insert method), `src/database/azure-blob/azure-blob-consolidation-repository.ts` (insert method)
**Description**: The `insert()` methods compute a global max ID by scanning all time-period blobs, then use `readModifyWrite` on the target blob. Under concurrent inserts that target *different* time-period blobs, two writers can simultaneously read the same global max and generate the same next ID, since `readModifyWrite` ETag protection only covers a single blob. This is acceptable for single-user low-concurrency scenarios but could cause duplicate IDs under high concurrency across period boundaries. A dedicated index blob or UUID-based IDs would fully solve this.

### P12 - Azure Blob markConsolidated writes to ALL period blobs unconditionally
**Severity**: Low
**Location**: `src/database/azure-blob/azure-blob-memory-repository.ts` (markConsolidated method)
**Description**: The `markConsolidated()` method iterates all time-period blobs and performs a `readModifyWrite` on each, even if none of the target IDs exist in that blob. This triggers unnecessary writes (and ETag checks) on blobs that have no matching IDs, increasing latency and Azure API call costs proportionally to the number of time periods.

### P1 - Design Deviations: ConnectionEntry interface mismatch
**Severity**: Medium
**Location**: `src/database/types.ts` (line 85-89)
**Description**: The design specifies `ConnectionEntry` with fields `{fromId: number, toId: number, relationship: string}` but the implementation uses `{type: string, targetId: number, description: string}`. The LLM schemas in `src/llm/types.ts` correctly use `{fromId, toId, relationship}` (matching the design), but the database layer type does not match. This means connections stored in the Memory table `connections` JSON field use a different shape than what the ConsolidateAgent produces. The `ConsolidateAgent` writes connections from the LLM result (with `fromId/toId/relationship`) but `MemoryRepository.updateConnections()` expects the database `ConnectionEntry` type (with `type/targetId/description`). Although `updateConnections()` is not currently called by the ConsolidateAgent (connections are only stored in the Consolidation table), this will be a bug if connections are ever written to individual Memory rows.

### P2 - Design Deviations: ProcessedFile table schema differs from design
**Severity**: Low
**Location**: `src/database/schema.ts` (line 31-36), `src/database/types.ts` (line 75-79)
**Description**: The design specifies `ProcessedFile` with `path TEXT PRIMARY KEY` and `ProcessedFileRow` with fields `{path, processedAt}`. The implementation uses `id INTEGER PRIMARY KEY AUTOINCREMENT, filePath TEXT NOT NULL UNIQUE` and `ProcessedFileRow` with fields `{id, filePath, processedAt}`. Functionally equivalent (UNIQUE constraint serves the same purpose), but the column name `filePath` vs `path` differs from the design.

### P3 - Design Deviations: NewMemory and NewConsolidation omit createdAt
**Severity**: Low
**Location**: `src/database/types.ts` (lines 34-44, 64-70)
**Description**: The design specifies `NewMemory` and `NewConsolidation` with a required `createdAt: string` field. The implementation omits this field and auto-generates the timestamp inside the repository `insert()` methods. This is a reasonable simplification but deviates from the design interface.

### P4 - Design Deviations: MemoryStats has extra fields
**Severity**: Low
**Location**: `src/database/types.ts` (lines 94-99)
**Description**: The design specifies `MemoryStats` with `{total, consolidated}`. The implementation adds `unconsolidated` and `consolidations` fields. The extra fields are useful but deviate from the design spec.

### P5 - Design Deviations: Prompts location differs from design
**Severity**: Low
**Location**: `src/llm/prompts.ts`
**Description**: The design (section 5.1) places prompts in `src/agents/prompts.ts` but the implementation places them in `src/llm/prompts.ts`. Functionally correct, but the file location differs from the design document.

### P6 - Design Deviations: Missing src/agents/types.ts and src/consolidation/types.ts
**Severity**: Low
**Location**: N/A
**Description**: The design specifies dedicated type files at `src/agents/types.ts` (with IngestInput, IngestOutput, ConsolidateOutput, QueryOutput interfaces) and `src/consolidation/types.ts` (with ConsolidationLoopState). These files were not created. Instead, agent output types are defined inline in each agent file (e.g., `ConsolidateResult` in `consolidate-agent.ts`, `QueryResponse` in `query-agent.ts`). This is a minor structural deviation.

### P7 - Design Deviation: Schema defaults differ from design
**Severity**: Low
**Location**: `src/database/schema.ts`
**Description**: Two schema defaults differ from the design: (a) `source` column in Memory table has no DEFAULT in implementation but design specifies `DEFAULT ''`; (b) `importance` column defaults to `0.0` in implementation but design specifies `DEFAULT 0.5`; (c) `userId` on Consolidation table has no DEFAULT in implementation but design specifies `DEFAULT 'default'`. These affect what happens if the corresponding fields are omitted during INSERT.

### P8 - Fastify schema validation missing additionalProperties: false
**Severity**: Low
**Location**: `src/api/routes.ts` (lines 66-75, 110-116)
**Description**: The design (section 4.8) specifies `additionalProperties: false` in the Fastify JSON schema for POST endpoints. The implementation omits this property. This means the API will silently accept extra fields in request bodies instead of rejecting them.

### P9 - Client SDK timeoutMs has a default/fallback value
**Severity**: Low
**Status**: Exception approved and documented in CLAUDE.md
**Location**: `src/client/memory-client.ts` (line 35)
**Description**: `this.timeoutMs = config.timeoutMs ?? 30000;` uses a fallback value of 30000. The project convention prohibits fallback values for configuration settings. However, this is a Client SDK convenience default for external consumers. The exception has been formally approved and documented in CLAUDE.md under "Configuration Default Value Exceptions" (approved 2026-03-09).

---

## Completed Items

### C6 - FIXED: SQL Server getAll() ordered by createdAt DESC instead of id ASC
**Severity**: Medium
**Location**: `src/database/sqlserver/sqlserver-memory-repository.ts` (line 49)
**Description**: The `getAll()` method used `ORDER BY createdAt DESC` while the `IMemoryRepository` interface contract specifies "ordered by id ascending" and the SQLite implementation uses `ORDER BY id ASC`. This caused inconsistent behavior across storage backends.
**Fix**: Changed query to `ORDER BY id ASC` to match the interface contract and SQLite behavior.

### C7 - FIXED: Azure Blob writeJsonBlob missing ifNoneMatch for new blob creation
**Severity**: Medium
**Location**: `src/database/azure-blob/blob-helpers.ts` (writeJsonBlob function)
**Description**: When `etag` was undefined (blob didn't exist yet), `writeJsonBlob` passed no conditions, allowing a concurrent creator to be silently overwritten. This broke the optimistic concurrency guarantee of the `readModifyWrite` pattern for first-write scenarios.
**Fix**: Added `ifNoneMatch: '*'` condition when no ETag is present, ensuring a 412 error if the blob was concurrently created between read and write.

### C8 - FIXED: Azure Blob insert() race condition on ID generation
**Severity**: Medium
**Location**: `src/database/azure-blob/azure-blob-memory-repository.ts`, `src/database/azure-blob/azure-blob-consolidation-repository.ts`
**Description**: The `insert()` methods called `getNextId()` before `readModifyWrite()`, so the ID was computed outside the atomic read-modify-write cycle. Two concurrent inserts into the same blob could both compute the same next ID. The blob-local items were not considered when generating the ID.
**Fix**: Moved ID computation inside the `readModifyWrite` callback, using `Math.max(globalMax, localMax + 1)` where `globalMax` is pre-computed from all periods and `localMax` is derived from the blob-local items at write time.

### C9 - FIXED: Azure Blob updateConnections/deleteById TOCTOU race condition
**Severity**: Medium
**Location**: `src/database/azure-blob/azure-blob-memory-repository.ts` (updateConnections, deleteById)
**Description**: Both methods performed a separate `readJsonBlob` to check if the target ID existed, then did a separate `readModifyWrite` to modify. Between the check and the write, the blob could have changed (item moved, deleted, or blob replaced). This is a classic Time-of-Check-Time-of-Use (TOCTOU) race.
**Fix**: Consolidated the existence check into the `readModifyWrite` callback, using a `found` flag set within the atomic modifier function. This ensures the check and modification happen against the same blob snapshot.

### C5 - FIXED: CLAUDE.md missing tool documentation (AC-08)
**Severity**: Medium
**Location**: `CLAUDE.md`
**Description**: Acceptance criterion AC-08 requires all tools to be documented in CLAUDE.md using the XML format specified in project conventions. The file only contained configuration exception notes.
**Fix**: Added XML-format documentation for two tools: `<always-memory-agent>` (main application) and `<memory-client-sdk>` (client SDK), documenting objectives, commands, parameters, and usage examples.

### C1 - FIXED: FileWatcher.stop() did not await chokidar.close()
**Severity**: Medium
**Location**: `src/watcher/file-watcher.ts` (line 59-64)
**Description**: Chokidar v4 `close()` returns a `Promise<void>`. The `stop()` method was synchronous (`stop(): void`) and did not await the promise, potentially causing incomplete cleanup during shutdown.
**Fix**: Changed `stop()` to `async stop(): Promise<void>` and added `await` before `this.watcher.close()`.

### C2 - FIXED: Signal handlers did not handle async promise
**Severity**: Low
**Location**: `src/index.ts` (lines 88-93)
**Description**: Signal handlers called `gracefulShutdown()` (which is async) without handling the returned promise. This could cause unhandled promise rejection warnings.
**Fix**: Added `void` prefix to explicitly discard the promise (matching the `void this.tick()` pattern used in ConsolidationLoop).

### C3 - FIXED: src/index.ts did not await fileWatcher.stop()
**Severity**: Low
**Location**: `src/index.ts` (line 75)
**Description**: After fixing C1, the shutdown sequence in `gracefulShutdown()` needed to await the now-async `fileWatcher.stop()`.
**Fix**: Changed `fileWatcher.stop()` to `await fileWatcher.stop()`.

### C4 - FIXED: Missing idx_consolidation_userId index
**Severity**: Low
**Location**: `src/database/schema.ts`
**Description**: The design specifies an index `idx_consolidation_userId ON Consolidation(userId)` which was missing from the implementation's `ALL_SCHEMA_STATEMENTS` array.
**Fix**: Added `CREATE_CONSOLIDATION_USER_ID_INDEX` constant and included it in `ALL_SCHEMA_STATEMENTS`. Updated barrel export in `src/database/index.ts`.
