# Always-On Memory Agent - Functional Requirements and Feature Descriptions

**Project**: TypeScript Always-On Memory Agent for User Preference Persistence
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

---

## Purpose

This document registers all functional requirements and feature descriptions for the Always-On Memory Agent project. It serves as the authoritative reference for what the system must do.

---

## Functional Requirements

### FR-01: Memory Ingestion

**Priority**: Critical
**Phase**: Phase 3 (Agent) + Phase 4 (API endpoint)

The system must accept text input (via HTTP API or file watcher), process it through an LLM to extract structured metadata, and persist the result in the SQLite database.

**Extracted metadata**:
- Summary: 1-2 sentence summary focusing on user preferences
- Entities: Key people, products, features, settings, categories
- Topics: 2-4 topic tags (free-form, LLM-determined)
- Importance: Score from 0.0 to 1.0 (preferences typically 0.6-1.0)

**Input channels**:
- `POST /ingest` API endpoint with `{ text: string, source?: string }` body
- File drop into the watched inbox directory

**Output**: A `Memory` record stored in the database with all extracted fields.

---

### FR-02: Memory Consolidation

**Priority**: Critical
**Phase**: Phase 3 (Agent) + Phase 6 (Loop)

The system must periodically review all unconsolidated memories, identify cross-cutting patterns and relationships between user preferences, generate consolidated insights, and mark processed memories as consolidated.

**Rules**:
- Minimum 2 unconsolidated memories required to trigger consolidation
- Consolidation runs on a configurable timer interval (`CONSOLIDATION_INTERVAL_MS`)
- Can also be triggered manually via `POST /consolidate`
- Identifies: contradictory preferences, complementary preferences, category-level patterns, temporal evolution

**Output**: A `Consolidation` record with summary, insight, and source memory IDs. Source memories are marked as consolidated.

---

### FR-03: Memory Query

**Priority**: Critical
**Phase**: Phase 3 (Agent) + Phase 4 (API endpoint)

The system must accept natural language questions, retrieve all stored memories and consolidation insights, and return a synthesized answer with source citations.

**Query behavior**:
- Reads all memories and consolidations into LLM context
- Synthesizes answer based ONLY on stored data
- References source memory IDs in the response (e.g., [Memory 42])
- Includes confidence indication
- Honestly reports when no relevant memories exist

**Endpoint**: `GET /query?q=<question>`

---

### FR-04: File Watching

**Priority**: High
**Phase**: Phase 5

The system must monitor a configurable directory (`WATCH_DIRECTORY`) for new files, automatically ingest supported file types, and track processed files to prevent re-ingestion.

**Supported file types**: `.txt`, `.md`, `.json`, `.csv`, `.yaml`, `.yml`, `.xml`

**Behavior**:
- Auto-creates the watch directory if it does not exist
- Detects new files within 10 seconds of being dropped
- Reads file content as UTF-8 text
- Passes content to IngestAgent with file path as `source`
- Records processed files in `ProcessedFile` table
- Skips files that have already been processed
- Ignores unsupported file extensions

---

### FR-05: Memory Management

**Priority**: High
**Phase**: Phase 2 (Database) + Phase 4 (API endpoints)

The system must support CRUD operations on memories:

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List all | `GET /memories` | Returns all stored memories |
| Delete one | `POST /delete` | Deletes a memory by ID |
| Clear all | `POST /clear` | Deletes all memories and consolidations |
| Statistics | `GET /status` | Returns total memories, consolidated count, consolidation count |

---

### FR-06: HTTP API

**Priority**: Critical
**Phase**: Phase 4

The system must expose a RESTful HTTP API via Fastify on a configurable port (`API_PORT`).

**Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | System status: memory count, consolidated count, consolidation count |
| `GET` | `/memories` | List all stored memories |
| `GET` | `/query` | Query memories with `?q=<question>` parameter |
| `POST` | `/ingest` | Ingest text: `{ text: string, source?: string }` |
| `POST` | `/consolidate` | Trigger manual consolidation |
| `POST` | `/delete` | Delete memory: `{ id: number }` |
| `POST` | `/clear` | Clear all memories and consolidations |

**Validation**: POST /ingest requires `text` field. POST /delete requires `id` field. Missing required fields return HTTP 400.

---

### FR-07: User Preference Focus

**Priority**: High
**Phase**: Phase 3

The IngestAgent must be tuned via system prompts to specifically identify and prioritize:
- Explicit preferences (stated likes, dislikes, choices)
- Implicit preferences (behavioral patterns, habits)
- Tool and technology choices
- UI and workflow preferences
- Communication style preferences

The ConsolidateAgent must identify preference-specific patterns:
- Contradictory preferences that need resolution
- Complementary preferences that reinforce each other
- Category-level patterns across preferences
- Temporal evolution of preferences

---

### FR-08: Agent Integration (Client SDK)

**Priority**: High
**Phase**: Phase 7

The system must provide a TypeScript client library that other agents can import to interact with the memory system without direct HTTP calls.

**Client interface**:
```typescript
class MemoryClient {
  constructor(options: { baseUrl: string });
  async ingest(text: string, source?: string): Promise<IngestResponse>;
  async query(question: string): Promise<QueryResponse>;
  async getPreferences(category?: string): Promise<PreferencesResponse>;
  async getStatus(): Promise<StatusResponse>;
}
```

**Requirements**:
- Uses native `fetch` (Node.js 18+) for HTTP communication
- No additional dependencies beyond the client module
- Typed responses for all methods
- Can be imported by any TypeScript project

---

### FR-09: Configuration Management

**Priority**: Critical
**Phase**: Phase 1

All configuration parameters must be loaded from environment variables. Missing required configuration must raise an exception with a clear message naming the missing variable. No fallback or default values are permitted.

**Required parameters**:

| Parameter | Env Variable | Type | Description |
|-----------|-------------|------|-------------|
| `llmProvider` | `LLM_PROVIDER` | string | LLM provider: "openai", "anthropic", "google" |
| `llmModel` | `LLM_MODEL` | string | Model identifier |
| `llmApiKey` | `LLM_API_KEY` | string | API key for the provider |
| `databasePath` | `DATABASE_PATH` | string | Path to SQLite file |
| `watchDirectory` | `WATCH_DIRECTORY` | string | Path to inbox directory |
| `apiPort` | `API_PORT` | number | HTTP server port |
| `consolidationIntervalMs` | `CONSOLIDATION_INTERVAL_MS` | number | Consolidation loop interval |

---

### FR-10: Graceful Startup and Shutdown

**Priority**: High
**Phase**: Phase 7

**Startup sequence**:
1. Load and validate configuration (throw on missing)
2. Initialize SQLite database (create tables if needed)
3. Create LLM provider instance
4. Create agent instances (Ingest, Consolidate, Query)
5. Start HTTP server on configured port
6. Start file watcher on configured directory
7. Start consolidation loop at configured interval
8. Log "System ready" with configuration summary

**Shutdown sequence** (triggered by SIGINT, SIGTERM):
1. Stop consolidation loop (clear timer)
2. Stop file watcher (close Chokidar)
3. Close HTTP server (stop accepting connections, drain existing)
4. Close database connection
5. Log "System shutdown complete"
6. Exit with code 0

---

## Feature Summary Matrix

| Feature | FR | Phase | Priority | Status |
|---------|-----|-------|----------|--------|
| Memory Ingestion | FR-01 | 3, 4 | Critical | Planned |
| Memory Consolidation | FR-02 | 3, 6 | Critical | Planned |
| Memory Query | FR-03 | 3, 4 | Critical | Planned |
| File Watching | FR-04 | 5 | High | Planned |
| Memory Management (CRUD) | FR-05 | 2, 4 | High | Planned |
| HTTP API | FR-06 | 4 | Critical | Planned |
| User Preference Focus | FR-07 | 3 | High | Planned |
| Agent Integration SDK | FR-08 | 7 | High | Planned |
| Configuration Management | FR-09 | 1 | Critical | Planned |
| Graceful Startup/Shutdown | FR-10 | 7 | High | Planned |

---

## Deferred Features (Phase 2 -- Future)

| Feature | Description | Reason for Deferral |
|---------|-------------|---------------------|
| Dashboard UI | Web-based visualization of memories and statistics | Focus on core engine first |
| Multi-tenancy | userId-based data isolation and authentication | Schema prepared with userId field; enforcement deferred |
| Memory Retention Policy | Age-based or count-based memory cleanup | Not required for initial operation |
| Vector/Embedding Search | Similarity-based retrieval for large memory sets | Current approach (full LLM context) sufficient for <100 memories |
| WebSocket Real-time Updates | Live memory feed for dashboard | HTTP polling sufficient for Phase 1 |
| Multimodal Processing | Image, audio, video ingestion | Text-only for Phase 1 |

---

## Acceptance Criteria (System-Level)

| ID | Criterion | Maps to FR |
|----|-----------|-----------|
| AC-01 | Running the app starts HTTP server, file watcher, and consolidation loop | FR-06, FR-04, FR-02, FR-10 |
| AC-02 | POST /ingest stores a memory with summary, entities, topics, importance | FR-01 |
| AC-03 | Dropping a .txt file into watched directory triggers ingestion within 10s | FR-04 |
| AC-04 | After 3+ memories, POST /consolidate produces at least one consolidation | FR-02 |
| AC-05 | GET /query returns synthesized answer referencing stored memories | FR-03 |
| AC-06 | Client SDK ingest(), query(), getPreferences() work from external project | FR-08 |
| AC-07 | Missing config variable throws clear error and exits | FR-09 |
| AC-08 | All tools documented in CLAUDE.md with XML format | Project convention |
| AC-09 | System handles 50+ memories without query performance degradation | FR-03 |
| AC-10 | GET /status returns accurate counts | FR-05 |
