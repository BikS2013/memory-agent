# Issues - Pending Items

## Pending Items

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
