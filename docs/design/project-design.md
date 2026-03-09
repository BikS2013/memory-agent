# Technical Design: TypeScript Always-On Memory Agent

**Version**: 1.0
**Created**: 2026-03-09
**Status**: Approved for Implementation

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Data Models](#2-data-models)
3. [Database Schema](#3-database-schema)
4. [API Contracts](#4-api-contracts)
5. [Module Organization](#5-module-organization)
6. [Agent System Prompts](#6-agent-system-prompts)
7. [LLM Integration](#7-llm-integration)
8. [Configuration](#8-configuration)
9. [Client SDK Interface](#9-client-sdk-interface)
10. [Error Handling](#10-error-handling)
11. [Lifecycle Management](#11-lifecycle-management)
12. [Parallel Implementation Units](#12-parallel-implementation-units)

---

## 1. System Architecture

### High-Level Component Diagram

```
+-----------------------------------------------------------------------------------+
|                           Always-On Memory Agent                                   |
|                                                                                   |
|  +------------------+     +------------------+     +------------------+            |
|  |   HTTP API       |     |  File Watcher    |     | Consolidation    |            |
|  |   (Fastify)      |     |  (Chokidar v4)   |     | Loop (Timer)     |            |
|  |                  |     |                  |     |                  |            |
|  |  GET /status     |     |  Monitors inbox/ |     |  Periodic tick   |            |
|  |  GET /memories   |     |  Detects new     |     |  at configured   |            |
|  |  GET /query      |     |  files, reads    |     |  interval        |            |
|  |  POST /ingest    |     |  content         |     |                  |            |
|  |  POST /consolidate     |                  |     |                  |            |
|  |  POST /delete    |     +--------+---------+     +--------+---------+            |
|  |  POST /clear     |              |                         |                     |
|  +--------+---------+              |                         |                     |
|           |                        |                         |                     |
|           v                        v                         v                     |
|  +--------+------------------------+-------------------------+---------+           |
|  |                         Agent Layer                                 |           |
|  |                                                                     |           |
|  |  +----------------+   +--------------------+   +----------------+   |           |
|  |  |  IngestAgent   |   | ConsolidateAgent   |   |  QueryAgent    |   |           |
|  |  |                |   |                    |   |                |   |           |
|  |  | - Receives raw |   | - Reads unconsol.  |   | - Reads all    |   |           |
|  |  |   text+source  |   |   memories         |   |   memories &   |   |           |
|  |  | - Calls LLM    |   | - Calls LLM to     |   |   consolidations|  |           |
|  |  |   for metadata |   |   find patterns    |   | - Calls LLM    |   |           |
|  |  |   extraction   |   | - Stores consol.   |   |   to synthesize|   |           |
|  |  | - Stores in DB |   | - Marks memories   |   |   answer       |   |           |
|  |  +-------+--------+   +----------+---------+   +-------+--------+   |           |
|  |          |                        |                     |           |           |
|  +----------+------------------------+---------------------+-----------+           |
|             |                        |                     |                       |
|             v                        v                     v                       |
|  +----------+------------------------+---------------------+-----------+           |
|  |                        LLM Integration Layer                        |           |
|  |                                                                     |           |
|  |  +--------------------+    +-------------------+                    |           |
|  |  | Provider Factory   |    | Zod Schemas       |                    |           |
|  |  | (LangChain.js)     |    |                   |                    |           |
|  |  |                    |    | MemoryExtraction   |                    |           |
|  |  | - ChatOpenAI       |    | ConsolidationResult|                   |           |
|  |  | - ChatAnthropic    |    | QueryResult        |                   |           |
|  |  | - ChatGoogleGenAI  |    +-------------------+                    |           |
|  |  +--------------------+                                             |           |
|  +---------------------------------------------------------------------+           |
|             |                        |                     |                       |
|             v                        v                     v                       |
|  +----------+------------------------+---------------------+-----------+           |
|  |                       Database Layer                                |           |
|  |                       (better-sqlite3)                              |           |
|  |                                                                     |           |
|  |  +-------------------+ +---------------------+ +------------------+ |           |
|  |  | MemoryRepository  | | ConsolidationRepo   | | ProcessedFileRepo| |           |
|  |  |                   | |                     | |                  | |           |
|  |  | insert()          | | insert()            | | isProcessed()   | |           |
|  |  | getAll()          | | getAll()            | | markProcessed() | |           |
|  |  | getById()         | | deleteAll()         | | getAll()        | |           |
|  |  | getUnconsolidated | | getCount()          | +------------------+ |           |
|  |  | markConsolidated()| +---------------------+                      |           |
|  |  | deleteById()      |                                              |           |
|  |  | deleteAll()       |                                              |           |
|  |  | getStats()        |                                              |           |
|  |  +-------------------+                                              |           |
|  |                                                                     |           |
|  |                    SQLite Database File                              |           |
|  |              +----------+------------+--------------+               |           |
|  |              | Memory   | Consolidation| ProcessedFile|              |           |
|  |              +----------+------------+--------------+               |           |
|  +---------------------------------------------------------------------+           |
|                                                                                   |
|  +---------------------------------------------------------------------+           |
|  |                    Configuration Layer                               |           |
|  |                                                                     |           |
|  |  - Reads environment variables                                      |           |
|  |  - Validates ALL required parameters                                |           |
|  |  - Throws exceptions on missing values (NO fallbacks)               |           |
|  +---------------------------------------------------------------------+           |
+-----------------------------------------------------------------------------------+

External Consumers:
+-----------------------------------------------------------------------------------+
|                          Client SDK (MemoryClient)                                 |
|                                                                                   |
|  import { MemoryClient } from 'always-memory-on/client';                          |
|                                                                                   |
|  const client = new MemoryClient({ baseUrl: 'http://localhost:8888' });           |
|  await client.ingest('User prefers dark mode', 'agent-ui');                       |
|  await client.query('What are the UI preferences?');                              |
|  await client.getPreferences('ui');                                               |
+-----------------------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Dependencies |
|-----------|---------------|--------------|
| **Configuration** | Load and validate env vars; throw on missing | None |
| **Database** | Schema creation, connection management, CRUD | Configuration |
| **LLM Layer** | Provider factory, structured output schemas | Configuration |
| **IngestAgent** | Extract metadata from text via LLM, persist | LLM Layer, Database |
| **ConsolidateAgent** | Find patterns across memories via LLM, persist | LLM Layer, Database |
| **QueryAgent** | Synthesize answers from memories via LLM | LLM Layer, Database |
| **HTTP API** | REST endpoints, request validation, routing | All Agents, Database |
| **File Watcher** | Monitor inbox, detect new files, trigger ingestion | IngestAgent, Database |
| **Consolidation Loop** | Periodic timer, trigger consolidation | ConsolidateAgent |
| **Client SDK** | HTTP client for external agent integration | HTTP API (runtime) |

### Data Flow

```
                    Ingestion Flow
                    ==============

  File Drop / POST /ingest
         |
         v
  +------+-------+
  | Raw Text     |
  | + Source      |
  +------+-------+
         |
         v
  +------+-------+     +------------------+
  | IngestAgent  +---->| LLM (structured  |
  |              |<----| output)          |
  +------+-------+     +------------------+
         |                    |
         |   MemoryExtraction |
         |   {summary, entities, topics, importance}
         v
  +------+-------+
  | Memory Table |
  +--------------+


                 Consolidation Flow
                 ==================

  Timer Tick / POST /consolidate
         |
         v
  +------+-----------+
  | Read unconsol.   |
  | memories (>=2)   |
  +------+-----------+
         |
         v
  +------+-----------+     +------------------+
  | ConsolidateAgent +---->| LLM (structured  |
  |                  |<----| output)          |
  +------+-----------+     +------------------+
         |                    |
         |  ConsolidationResult
         |  {summary, insight, connections}
         v
  +------+-----------+     +------------------+
  | Consolidation    |     | Mark memories as |
  | Table            |     | consolidated=1   |
  +-----------------+     +------------------+


                    Query Flow
                    ==========

  GET /query?q=...
         |
         v
  +------+-----------+
  | Read all memories|
  | + consolidations |
  +------+-----------+
         |
         v
  +------+-----------+     +------------------+
  | QueryAgent      +---->| LLM (structured  |
  |                  |<----| output)          |
  +------+-----------+     +------------------+
         |                    |
         |  QueryResult
         |  {answer, sourceMemoryIds, confidence}
         v
  +------+-----------+
  | JSON Response    |
  +-----------------+
```

---

## 2. Data Models

All TypeScript interfaces are defined with strict types. JSON-serialized fields use `string` at the database row level and parsed types at the application level.

### 2.1 Configuration Types

**File**: `src/config/types.ts`

```typescript
/**
 * Complete application configuration.
 * Every field is REQUIRED. Missing values cause an exception at startup.
 * No default values. No fallbacks.
 */
export interface AppConfig {
  /** LLM provider identifier: "openai" | "anthropic" | "google" */
  readonly llmProvider: LlmProvider;

  /** Model identifier (e.g., "gpt-4", "claude-sonnet-4-20250514", "gemini-2.0-flash") */
  readonly llmModel: string;

  /** API key for the selected LLM provider */
  readonly llmApiKey: string;

  /** Absolute or relative path to the SQLite database file */
  readonly databasePath: string;

  /** Absolute or relative path to the inbox directory for file watching */
  readonly watchDirectory: string;

  /** HTTP server port number */
  readonly apiPort: number;

  /** Consolidation loop interval in milliseconds */
  readonly consolidationIntervalMs: number;
}

/** Supported LLM provider identifiers */
export type LlmProvider = 'openai' | 'anthropic' | 'google';

/** Valid LLM provider names for validation */
export const VALID_LLM_PROVIDERS: readonly LlmProvider[] = [
  'openai',
  'anthropic',
  'google',
] as const;
```

### 2.2 Database Row Types

**File**: `src/database/types.ts`

```typescript
/**
 * Represents a row in the Memory table exactly as stored in SQLite.
 * JSON fields (entities, topics, connections) are stored as TEXT strings.
 */
export interface MemoryRow {
  readonly id: number;
  readonly userId: string;
  readonly source: string;
  readonly rawText: string;
  readonly summary: string;
  /** JSON-serialized string[] */
  readonly entities: string;
  /** JSON-serialized string[] */
  readonly topics: string;
  readonly importance: number;
  /** 0 = not consolidated, 1 = consolidated */
  readonly consolidated: number;
  /** JSON-serialized ConnectionEntry[] */
  readonly connections: string;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
}

/**
 * Input type for inserting a new Memory row.
 * The `id` is auto-generated. `consolidated` defaults to 0. `connections` defaults to '[]'.
 */
export interface NewMemory {
  readonly userId: string;
  readonly source: string;
  readonly rawText: string;
  readonly summary: string;
  /** JSON-serialized string[] */
  readonly entities: string;
  /** JSON-serialized string[] */
  readonly topics: string;
  readonly importance: number;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
}

/**
 * Represents a row in the Consolidation table exactly as stored in SQLite.
 */
export interface ConsolidationRow {
  readonly id: number;
  readonly userId: string;
  /** JSON-serialized number[] - IDs of source memories */
  readonly sourceIds: string;
  readonly summary: string;
  readonly insight: string;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
}

/**
 * Input type for inserting a new Consolidation row.
 */
export interface NewConsolidation {
  readonly userId: string;
  /** JSON-serialized number[] */
  readonly sourceIds: string;
  readonly summary: string;
  readonly insight: string;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
}

/**
 * Represents a row in the ProcessedFile table.
 */
export interface ProcessedFileRow {
  readonly path: string;
  /** ISO 8601 timestamp */
  readonly processedAt: string;
}

/**
 * A connection between two memories, used in the connections JSON field.
 */
export interface ConnectionEntry {
  readonly fromId: number;
  readonly toId: number;
  readonly relationship: string;
}

/**
 * Memory statistics returned by the repository.
 */
export interface MemoryStats {
  readonly total: number;
  readonly consolidated: number;
}
```

### 2.3 LLM Schema Types

**File**: `src/llm/types.ts`

```typescript
/**
 * Structured output from the IngestAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface MemoryExtraction {
  /** 1-2 sentence summary focusing on user preferences */
  readonly summary: string;
  /** Key entities: people, products, features, settings, categories */
  readonly entities: string[];
  /** 2-4 topic tags (e.g., "ui-preferences", "workflow", "tools") */
  readonly topics: string[];
  /** Importance rating from 0.0 to 1.0 */
  readonly importance: number;
}

/**
 * Structured output from the ConsolidateAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface ConsolidationResult {
  /** Synthesized summary of preference patterns across memories */
  readonly summary: string;
  /** One actionable insight for agents to leverage */
  readonly insight: string;
  /** Connections between memories discovered during consolidation */
  readonly connections: ConsolidationConnection[];
}

/**
 * A connection discovered during consolidation.
 */
export interface ConsolidationConnection {
  readonly fromId: number;
  readonly toId: number;
  readonly relationship: string;
}

/**
 * Structured output from the QueryAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface QueryResult {
  /** Synthesized answer based on stored memories */
  readonly answer: string;
  /** IDs of memories referenced in the answer */
  readonly sourceMemoryIds: number[];
  /** Confidence level: "high", "medium", "low" */
  readonly confidence: string;
}
```

### 2.4 Agent Types

**File**: `src/agents/types.ts`

```typescript
import type { MemoryRow, ConsolidationRow } from '../database/types.js';
import type { MemoryExtraction, ConsolidationResult, QueryResult } from '../llm/types.js';

/**
 * Input to the IngestAgent.
 */
export interface IngestInput {
  /** Raw text content to process */
  readonly text: string;
  /** Source identifier (e.g., file path, "api", agent name) */
  readonly source: string;
}

/**
 * Output from the IngestAgent.
 */
export interface IngestOutput {
  /** The stored memory row, including generated ID */
  readonly memory: MemoryRow;
  /** The extracted metadata from the LLM */
  readonly extraction: MemoryExtraction;
}

/**
 * Output from the ConsolidateAgent.
 */
export interface ConsolidateOutput {
  /** Whether consolidation was performed (false if < 2 unconsolidated memories) */
  readonly consolidated: boolean;
  /** Number of memories that were consolidated */
  readonly memoriesProcessed: number;
  /** The stored consolidation row, if consolidation was performed */
  readonly consolidation: ConsolidationRow | null;
}

/**
 * Output from the QueryAgent.
 */
export interface QueryOutput {
  /** The synthesized answer */
  readonly answer: string;
  /** Source memory IDs referenced in the answer */
  readonly sourceMemoryIds: number[];
  /** Confidence level */
  readonly confidence: string;
  /** Number of memories considered */
  readonly memoriesConsidered: number;
  /** Number of consolidations considered */
  readonly consolidationsConsidered: number;
}
```

### 2.5 API Types

**File**: `src/api/types.ts`

```typescript
import type { MemoryRow, ConsolidationRow } from '../database/types.js';

// ---- Request Types ----

export interface IngestRequestBody {
  readonly text: string;
  readonly source?: string;
}

export interface DeleteRequestBody {
  readonly id: number;
}

export interface QueryQuerystring {
  readonly q: string;
}

// ---- Response Types ----

export interface StatusResponse {
  readonly status: 'running';
  readonly memories: number;
  readonly consolidated: number;
  readonly consolidations: number;
  readonly uptime: number;
}

export interface MemoriesResponse {
  readonly memories: MemoryRow[];
}

export interface IngestResponse {
  readonly status: 'ingested';
  readonly memory: MemoryRow;
}

export interface QueryResponse {
  readonly answer: string;
  readonly sources: number[];
  readonly confidence: string;
  readonly memoriesConsidered: number;
  readonly consolidationsConsidered: number;
}

export interface ConsolidateResponse {
  readonly status: 'consolidated' | 'skipped';
  readonly memoriesProcessed: number;
  readonly consolidation: ConsolidationRow | null;
}

export interface DeleteResponse {
  readonly status: 'deleted' | 'not_found';
  readonly deleted: boolean;
}

export interface ClearResponse {
  readonly status: 'cleared';
  readonly memoriesCleared: number;
  readonly consolidationsCleared: number;
}

export interface ErrorResponse {
  readonly error: string;
  readonly statusCode: number;
}
```

### 2.6 Client SDK Types

**File**: `src/client/types.ts`

```typescript
/**
 * Configuration for the MemoryClient.
 */
export interface MemoryClientConfig {
  /** Base URL of the Always-On Memory Agent HTTP API (e.g., "http://localhost:8888") */
  readonly baseUrl: string;
  /** Optional request timeout in milliseconds */
  readonly timeoutMs?: number;
}

/**
 * Response from the ingest operation via the client.
 */
export interface ClientIngestResponse {
  readonly status: 'ingested';
  readonly memory: {
    readonly id: number;
    readonly summary: string;
    readonly entities: string[];
    readonly topics: string[];
    readonly importance: number;
    readonly createdAt: string;
  };
}

/**
 * Response from the query operation via the client.
 */
export interface ClientQueryResponse {
  readonly answer: string;
  readonly sources: number[];
  readonly confidence: string;
}

/**
 * Response from the getPreferences operation via the client.
 * Returns memories filtered by topic/category.
 */
export interface ClientPreferencesResponse {
  readonly preferences: Array<{
    readonly id: number;
    readonly summary: string;
    readonly topics: string[];
    readonly importance: number;
    readonly createdAt: string;
  }>;
}

/**
 * Response from the getStatus operation via the client.
 */
export interface ClientStatusResponse {
  readonly status: 'running';
  readonly memories: number;
  readonly consolidated: number;
  readonly consolidations: number;
  readonly uptime: number;
}
```

### 2.7 Watcher Types

**File**: `src/watcher/types.ts`

```typescript
/** File extensions supported for automatic ingestion */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.xml',
] as const;

/**
 * Result of processing a file from the inbox.
 */
export interface FileProcessResult {
  readonly filePath: string;
  readonly content: string;
  readonly extension: string;
}
```

### 2.8 Consolidation Loop Types

**File**: `src/consolidation/types.ts`

```typescript
/**
 * State of the consolidation loop.
 */
export interface ConsolidationLoopState {
  readonly running: boolean;
  readonly lastRunAt: string | null;
  readonly totalRuns: number;
  readonly totalConsolidations: number;
}
```

---

## 3. Database Schema

### 3.1 Full DDL Statements

**File**: `src/database/schema.ts`

```sql
-- ============================================================
-- Memory Table
-- Stores individual preference/information units extracted
-- from ingested text via the IngestAgent.
-- ============================================================
CREATE TABLE IF NOT EXISTS Memory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL DEFAULT 'default',
    source          TEXT    NOT NULL DEFAULT '',
    rawText         TEXT    NOT NULL,
    summary         TEXT    NOT NULL,
    entities        TEXT    NOT NULL DEFAULT '[]',      -- JSON: string[]
    topics          TEXT    NOT NULL DEFAULT '[]',      -- JSON: string[]
    importance      REAL    NOT NULL DEFAULT 0.5,
    consolidated    INTEGER NOT NULL DEFAULT 0,         -- 0=false, 1=true
    connections     TEXT    NOT NULL DEFAULT '[]',      -- JSON: ConnectionEntry[]
    createdAt       TEXT    NOT NULL                    -- ISO 8601
);

-- ============================================================
-- Consolidation Table
-- Stores cross-memory patterns and insights generated
-- by the ConsolidateAgent.
-- ============================================================
CREATE TABLE IF NOT EXISTS Consolidation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL DEFAULT 'default',
    sourceIds       TEXT    NOT NULL,                   -- JSON: number[]
    summary         TEXT    NOT NULL,
    insight         TEXT    NOT NULL,
    createdAt       TEXT    NOT NULL                    -- ISO 8601
);

-- ============================================================
-- ProcessedFile Table
-- Tracks files that have been ingested by the file watcher
-- to prevent duplicate processing.
-- ============================================================
CREATE TABLE IF NOT EXISTS ProcessedFile (
    path            TEXT    PRIMARY KEY,
    processedAt     TEXT    NOT NULL                    -- ISO 8601
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_memory_userId
    ON Memory(userId);

CREATE INDEX IF NOT EXISTS idx_memory_consolidated
    ON Memory(consolidated);

CREATE INDEX IF NOT EXISTS idx_memory_importance
    ON Memory(importance);

CREATE INDEX IF NOT EXISTS idx_consolidation_userId
    ON Consolidation(userId);
```

### 3.2 Schema Constants in TypeScript

```typescript
// src/database/schema.ts

export const CREATE_MEMORY_TABLE = `
CREATE TABLE IF NOT EXISTS Memory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL DEFAULT 'default',
    source          TEXT    NOT NULL DEFAULT '',
    rawText         TEXT    NOT NULL,
    summary         TEXT    NOT NULL,
    entities        TEXT    NOT NULL DEFAULT '[]',
    topics          TEXT    NOT NULL DEFAULT '[]',
    importance      REAL    NOT NULL DEFAULT 0.5,
    consolidated    INTEGER NOT NULL DEFAULT 0,
    connections     TEXT    NOT NULL DEFAULT '[]',
    createdAt       TEXT    NOT NULL
);`;

export const CREATE_CONSOLIDATION_TABLE = `
CREATE TABLE IF NOT EXISTS Consolidation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL DEFAULT 'default',
    sourceIds       TEXT    NOT NULL,
    summary         TEXT    NOT NULL,
    insight         TEXT    NOT NULL,
    createdAt       TEXT    NOT NULL
);`;

export const CREATE_PROCESSED_FILE_TABLE = `
CREATE TABLE IF NOT EXISTS ProcessedFile (
    path            TEXT    PRIMARY KEY,
    processedAt     TEXT    NOT NULL
);`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_memory_userId ON Memory(userId);
CREATE INDEX IF NOT EXISTS idx_memory_consolidated ON Memory(consolidated);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON Memory(importance);
CREATE INDEX IF NOT EXISTS idx_consolidation_userId ON Consolidation(userId);
`;

export const ALL_SCHEMA_STATEMENTS: readonly string[] = [
  CREATE_MEMORY_TABLE,
  CREATE_CONSOLIDATION_TABLE,
  CREATE_PROCESSED_FILE_TABLE,
  CREATE_INDEXES,
];
```

### 3.3 JSON Field Conventions

| Table | Column | JSON Type | Example Value |
|-------|--------|-----------|---------------|
| Memory | entities | `string[]` | `["dark mode", "VSCode", "TypeScript"]` |
| Memory | topics | `string[]` | `["ui-preferences", "development-tools"]` |
| Memory | connections | `ConnectionEntry[]` | `[{"fromId":1,"toId":3,"relationship":"complementary"}]` |
| Consolidation | sourceIds | `number[]` | `[1, 3, 7]` |

All JSON fields are stored as TEXT in SQLite. Serialization uses `JSON.stringify()` before insert and `JSON.parse()` after read. The repository layer handles this transparently.

### 3.4 Repository Method Signatures

**MemoryRepository**:

```typescript
export class MemoryRepository {
  constructor(db: Database.Database);

  insert(memory: NewMemory): MemoryRow;
  getAll(): MemoryRow[];
  getById(id: number): MemoryRow | undefined;
  getUnconsolidated(): MemoryRow[];
  markConsolidated(ids: number[]): void;
  updateConnections(id: number, connections: ConnectionEntry[]): void;
  deleteById(id: number): boolean;
  deleteAll(): number;
  getStats(): MemoryStats;
}
```

**ConsolidationRepository**:

```typescript
export class ConsolidationRepository {
  constructor(db: Database.Database);

  insert(consolidation: NewConsolidation): ConsolidationRow;
  getAll(): ConsolidationRow[];
  deleteAll(): number;
  getCount(): number;
}
```

**ProcessedFileRepository**:

```typescript
export class ProcessedFileRepository {
  constructor(db: Database.Database);

  isProcessed(path: string): boolean;
  markProcessed(path: string): void;
  getAll(): ProcessedFileRow[];
}
```

All repository methods use **prepared statements** for performance and SQL injection protection. Each repository receives the `Database.Database` instance via constructor injection.

---

## 4. API Contracts

### 4.1 GET /status

Returns system health and memory statistics.

**Request**: No parameters.

**Response** (200 OK):
```json
{
  "status": "running",
  "memories": 42,
  "consolidated": 35,
  "consolidations": 8,
  "uptime": 3600
}
```

| Field | Type | Description |
|-------|------|-------------|
| status | `"running"` | Always "running" if the server is responding |
| memories | `number` | Total number of memories in the database |
| consolidated | `number` | Number of memories marked as consolidated |
| consolidations | `number` | Total number of consolidation records |
| uptime | `number` | Server uptime in seconds |

---

### 4.2 GET /memories

Returns all stored memories.

**Request**: No parameters.

**Response** (200 OK):
```json
{
  "memories": [
    {
      "id": 1,
      "userId": "default",
      "source": "api",
      "rawText": "User prefers dark mode in all applications",
      "summary": "User preference: dark mode across all applications",
      "entities": "[\"dark mode\", \"applications\"]",
      "topics": "[\"ui-preferences\", \"visual-settings\"]",
      "importance": 0.8,
      "consolidated": 0,
      "connections": "[]",
      "createdAt": "2026-03-09T14:30:00.000Z"
    }
  ]
}
```

**Note**: The `entities`, `topics`, and `connections` fields are returned as JSON strings (as stored in SQLite). Clients must parse them with `JSON.parse()`.

---

### 4.3 GET /query

Queries memories using natural language and returns a synthesized answer.

**Request**: Query parameter `q` (required).

```
GET /query?q=What%20are%20the%20user's%20UI%20preferences?
```

**Response** (200 OK):
```json
{
  "answer": "The user prefers dark mode across all applications [Memory 1], compact layouts [Memory 3], and minimal animations [Memory 5]. A consolidation pattern shows consistent preference for minimalist interfaces [Consolidation 2].",
  "sources": [1, 3, 5],
  "confidence": "high",
  "memoriesConsidered": 12,
  "consolidationsConsidered": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| answer | `string` | Synthesized answer with memory citations |
| sources | `number[]` | Memory IDs referenced in the answer |
| confidence | `string` | "high", "medium", or "low" |
| memoriesConsidered | `number` | Total memories provided to the LLM |
| consolidationsConsidered | `number` | Total consolidations provided to the LLM |

**Response** (400 Bad Request) -- missing `q` parameter:
```json
{
  "error": "Query parameter 'q' is required",
  "statusCode": 400
}
```

---

### 4.4 POST /ingest

Ingests text content, extracts metadata via LLM, and stores as a memory.

**Request** (application/json):
```json
{
  "text": "User prefers dark mode in all applications",
  "source": "agent-ui"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| text | `string` | Yes | Raw text to ingest |
| source | `string` | No | Source identifier (defaults to `"api"`) |

**Response** (201 Created):
```json
{
  "status": "ingested",
  "memory": {
    "id": 1,
    "userId": "default",
    "source": "agent-ui",
    "rawText": "User prefers dark mode in all applications",
    "summary": "User preference: dark mode across all applications",
    "entities": "[\"dark mode\", \"applications\"]",
    "topics": "[\"ui-preferences\", \"visual-settings\"]",
    "importance": 0.8,
    "consolidated": 0,
    "connections": "[]",
    "createdAt": "2026-03-09T14:30:00.000Z"
  }
}
```

**Response** (400 Bad Request) -- missing `text` field:
```json
{
  "error": "Field 'text' is required and must be a non-empty string",
  "statusCode": 400
}
```

**Response** (500 Internal Server Error) -- LLM failure:
```json
{
  "error": "LLM processing failed: <error details>",
  "statusCode": 500
}
```

---

### 4.5 POST /consolidate

Triggers an immediate consolidation cycle.

**Request**: No body required.

**Response** (200 OK) -- consolidation performed:
```json
{
  "status": "consolidated",
  "memoriesProcessed": 5,
  "consolidation": {
    "id": 3,
    "userId": "default",
    "sourceIds": "[1, 2, 3, 4, 5]",
    "summary": "User shows consistent preference for minimalist, dark-themed interfaces with compact layouts",
    "insight": "The user values efficiency and visual comfort; agents should default to dark themes and information-dense layouts",
    "createdAt": "2026-03-09T15:00:00.000Z"
  }
}
```

**Response** (200 OK) -- consolidation skipped (fewer than 2 unconsolidated memories):
```json
{
  "status": "skipped",
  "memoriesProcessed": 0,
  "consolidation": null
}
```

---

### 4.6 POST /delete

Deletes a single memory by ID.

**Request** (application/json):
```json
{
  "id": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | `number` | Yes | Memory ID to delete |

**Response** (200 OK) -- memory deleted:
```json
{
  "status": "deleted",
  "deleted": true
}
```

**Response** (200 OK) -- memory not found:
```json
{
  "status": "not_found",
  "deleted": false
}
```

**Response** (400 Bad Request) -- missing `id`:
```json
{
  "error": "Field 'id' is required and must be a number",
  "statusCode": 400
}
```

---

### 4.7 POST /clear

Clears all memories and consolidations from the database.

**Request**: No body required.

**Response** (200 OK):
```json
{
  "status": "cleared",
  "memoriesCleared": 42,
  "consolidationsCleared": 8
}
```

---

### 4.8 Fastify Schema Validation

All POST endpoints use Fastify JSON Schema validation. Example for `/ingest`:

```typescript
const ingestSchema = {
  body: {
    type: 'object' as const,
    required: ['text'],
    properties: {
      text: { type: 'string', minLength: 1 },
      source: { type: 'string' },
    },
    additionalProperties: false,
  },
};
```

Fastify automatically returns 400 with a structured error message when validation fails.

---

## 5. Module Organization

### 5.1 Complete File Tree

```
always-memory-on/
|
+-- src/
|   |
|   +-- index.ts                              # Application entry point: startup/shutdown orchestration
|   |
|   +-- config/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # AppConfig interface, LlmProvider type
|   |   +-- config.ts                         # Reads process.env, calls validation, exports loadConfig()
|   |   +-- validation.ts                     # Validates all required config params, throws on missing
|   |
|   +-- database/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # MemoryRow, ConsolidationRow, ProcessedFileRow, etc.
|   |   +-- schema.ts                         # SQL DDL constants for all tables and indexes
|   |   +-- database.ts                       # initializeDatabase(), getDatabase(), closeDatabase()
|   |   +-- repositories/
|   |       +-- memory-repository.ts          # MemoryRepository class with prepared statements
|   |       +-- consolidation-repository.ts   # ConsolidationRepository class
|   |       +-- processed-file-repository.ts  # ProcessedFileRepository class
|   |
|   +-- llm/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # MemoryExtraction, ConsolidationResult, QueryResult
|   |   +-- schemas.ts                        # Zod schemas matching the types above
|   |   +-- provider-factory.ts               # createLlm(config) -> BaseChatModel
|   |
|   +-- agents/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # IngestInput, IngestOutput, ConsolidateOutput, QueryOutput
|   |   +-- prompts.ts                        # System prompt constants for all three agents
|   |   +-- ingest-agent.ts                   # IngestAgent class
|   |   +-- consolidate-agent.ts              # ConsolidateAgent class
|   |   +-- query-agent.ts                    # QueryAgent class
|   |
|   +-- api/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # Request/response type definitions
|   |   +-- server.ts                         # createServer(), startServer(), stopServer()
|   |   +-- routes/
|   |       +-- status-routes.ts              # GET /status, POST /consolidate
|   |       +-- memory-routes.ts              # GET /memories, POST /ingest, POST /delete, POST /clear
|   |       +-- query-routes.ts               # GET /query
|   |
|   +-- watcher/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # SUPPORTED_EXTENSIONS, FileProcessResult
|   |   +-- file-watcher.ts                   # FileWatcher class: start(), stop()
|   |   +-- processors/
|   |       +-- text-processor.ts             # readFileContent(path, ext) -> string
|   |
|   +-- consolidation/
|   |   +-- index.ts                          # Barrel export
|   |   +-- types.ts                          # ConsolidationLoopState
|   |   +-- consolidation-loop.ts             # ConsolidationLoop class: start(), stop()
|   |
|   +-- client/
|       +-- index.ts                          # Barrel export (also exported from package.json "exports")
|       +-- types.ts                          # MemoryClientConfig, response types
|       +-- memory-client.ts                  # MemoryClient class using native fetch
|
+-- tests/
|   +-- database/
|   |   +-- memory-repository.test.ts         # Unit tests for MemoryRepository
|   |   +-- consolidation-repository.test.ts  # Unit tests for ConsolidationRepository
|   |   +-- processed-file-repository.test.ts # Unit tests for ProcessedFileRepository
|   +-- llm/
|   |   +-- provider-factory.test.ts          # Provider factory instantiation tests
|   |   +-- schemas.test.ts                   # Zod schema validation tests
|   +-- agents/
|   |   +-- ingest-agent.test.ts              # IngestAgent tests (mocked LLM)
|   |   +-- consolidate-agent.test.ts         # ConsolidateAgent tests (mocked LLM)
|   |   +-- query-agent.test.ts               # QueryAgent tests (mocked LLM)
|   +-- api/
|   |   +-- routes.test.ts                    # HTTP endpoint tests using Fastify inject
|   +-- integration/
|       +-- full-flow.test.ts                 # End-to-end flow: ingest -> consolidate -> query
|
+-- test_scripts/
|   +-- test-ingest.ts                        # Manual test: ingest a sample preference
|   +-- test-client-sdk.ts                    # Manual test: exercise the MemoryClient
|
+-- docs/
|   +-- design/
|   |   +-- project-design.md                 # This document
|   |   +-- project-functions.md              # Functional requirements registry
|   |   +-- plan-001-always-on-memory-agent.md
|   +-- reference/
|       +-- refined-request-always-on-memory-agent.md
|       +-- investigation-always-on-memory-agent.md
|
+-- package.json                              # ESM project manifest
+-- tsconfig.json                             # Strict TypeScript config
+-- .gitignore                                # Ignore dist/, node_modules/, *.db, .env
+-- CLAUDE.md                                 # Project instructions and tool documentation
+-- Issues - Pending Items.md                 # Issue tracker
```

### 5.2 File Purpose Summary

| Module | File | Purpose |
|--------|------|---------|
| **config** | `config.ts` | Reads `process.env`, constructs `AppConfig`, calls validation |
| **config** | `validation.ts` | Asserts every required env var is present; throws `Error` with clear message |
| **config** | `types.ts` | `AppConfig` interface, `LlmProvider` union type |
| **database** | `database.ts` | Opens better-sqlite3 connection, runs DDL, provides `getDatabase()`/`closeDatabase()` |
| **database** | `schema.ts` | All `CREATE TABLE` and `CREATE INDEX` SQL as string constants |
| **database** | `types.ts` | Row types (`MemoryRow`, etc.), insert types (`NewMemory`, etc.) |
| **database** | `memory-repository.ts` | Prepared statements for all Memory CRUD operations |
| **database** | `consolidation-repository.ts` | Prepared statements for Consolidation CRUD |
| **database** | `processed-file-repository.ts` | Prepared statements for ProcessedFile tracking |
| **llm** | `provider-factory.ts` | Factory: config -> LangChain `BaseChatModel` instance |
| **llm** | `schemas.ts` | Zod schemas for `MemoryExtraction`, `ConsolidationResult`, `QueryResult` |
| **llm** | `types.ts` | TypeScript interfaces matching the Zod schemas |
| **agents** | `prompts.ts` | System prompt string constants for all three agents |
| **agents** | `ingest-agent.ts` | `IngestAgent` class: text -> LLM extraction -> DB insert |
| **agents** | `consolidate-agent.ts` | `ConsolidateAgent` class: unconsolidated memories -> LLM patterns -> DB insert |
| **agents** | `query-agent.ts` | `QueryAgent` class: question + context -> LLM synthesis -> response |
| **agents** | `types.ts` | Agent input/output interfaces |
| **api** | `server.ts` | Creates Fastify instance, registers route plugins, exports start/stop |
| **api** | `routes/*.ts` | Route handlers for each endpoint group |
| **api** | `types.ts` | HTTP request/response type definitions |
| **watcher** | `file-watcher.ts` | Chokidar setup, event handlers, dedup via ProcessedFileRepository |
| **watcher** | `text-processor.ts` | Reads file content as UTF-8 |
| **consolidation** | `consolidation-loop.ts` | `setInterval` timer that calls ConsolidateAgent |
| **client** | `memory-client.ts` | `MemoryClient` class with `ingest()`, `query()`, `getPreferences()` |
| **entry** | `index.ts` | Startup sequence, signal handlers, shutdown sequence |

---

## 6. Agent System Prompts

### 6.1 IngestAgent System Prompt

**File**: `src/agents/prompts.ts`

```typescript
export const INGEST_AGENT_SYSTEM_PROMPT = `You are a Memory Ingest Agent specialized in capturing user preferences and behavioral patterns.

Your task is to analyze the provided text and extract structured metadata about user preferences. For any input you receive:

1. IDENTIFY explicit preferences (stated likes, dislikes, choices, settings)
2. IDENTIFY implicit preferences (behavioral patterns, habits, workflow choices)
3. CREATE a concise 1-2 sentence summary focusing on the preference or behavioral pattern
4. EXTRACT key entities (people, products, features, settings, tools, categories)
5. ASSIGN 2-4 topic tags that categorize this preference (e.g., "ui-preferences", "workflow", "tools", "communication-style", "development-practices")
6. RATE importance from 0.0 to 1.0:
   - 0.0-0.3: Minor observation, not a clear preference
   - 0.4-0.6: Moderate preference, mentioned in passing
   - 0.7-0.8: Clear, stated preference
   - 0.9-1.0: Strong, emphatic preference or critical behavioral pattern

Examples of preferences to capture:
- UI settings: "prefers dark mode", "likes compact layouts", "wants large fonts"
- Workflow patterns: "always reviews code before committing", "prefers TDD"
- Tool choices: "uses VSCode for TypeScript", "prefers npm over yarn"
- Communication style: "prefers concise responses", "likes detailed explanations"
- Development practices: "follows strict typing", "prefers functional programming"

Rules:
- Always preserve the full context of what was said
- Be precise about WHAT the user prefers and WHY (if stated)
- If the text contains no identifiable preferences, still extract whatever informational value exists but rate importance low (0.1-0.3)
- Do NOT hallucinate preferences that are not present in the text
- Topic tags should be lowercase, hyphenated (e.g., "ui-preferences" not "UI Preferences")`;
```

### 6.2 ConsolidateAgent System Prompt

```typescript
export const CONSOLIDATE_AGENT_SYSTEM_PROMPT = `You are a Memory Consolidation Agent specialized in identifying user preference patterns.

You will be given a set of individual user preference memories. Your role is to analyze them collectively and identify higher-order patterns, connections, and insights.

Your task:

1. ANALYZE all provided memories for cross-cutting patterns
2. IDENTIFY the following types of relationships:
   - Contradictory preferences that may need resolution (e.g., "wants speed" vs "wants thoroughness")
   - Complementary preferences that reinforce each other (e.g., "dark mode" + "minimal UI" = "minimalist aesthetic")
   - Category-level patterns (e.g., multiple UI preferences suggest "user values visual comfort")
   - Temporal evolution (if timestamps suggest changing preferences over time)
3. CREATE a synthesized summary highlighting the key preference patterns found
4. GENERATE one actionable insight that agents can leverage when interacting with this user
5. MAP connections between specific memories using their IDs

Connection types to use:
- "complementary": preferences that work together naturally
- "contradictory": preferences that conflict with each other
- "reinforces": one preference strengthens another
- "evolves_from": a newer preference replaces an older one
- "related": preferences in the same category or domain

Example patterns to identify:
- "User consistently prefers performance over features across tools"
- "Dark mode preference extends to all applications - strong visual comfort pattern"
- "Prefers automated workflows but wants manual control for critical operations"
- "Communication style preferences indicate user values efficiency and directness"

Rules:
- Only identify patterns that are genuinely supported by the memories
- The insight should be actionable - something an agent can use to better serve the user
- Be specific in your connections - reference actual memory IDs
- If memories are unrelated, say so rather than forcing connections`;
```

### 6.3 QueryAgent System Prompt

```typescript
export const QUERY_AGENT_SYSTEM_PROMPT = `You are a Memory Query Agent specialized in retrieving and synthesizing user preference information.

You will be given:
1. A natural language question about user preferences
2. A set of stored user preference memories (with IDs)
3. A set of consolidation insights (with IDs)

Your task is to synthesize an accurate, helpful answer based ONLY on the stored information.

Response requirements:

1. ANSWER the question using only information from the provided memories and consolidations
2. CITE specific memories using the format [Memory X] where X is the memory ID
3. CITE consolidation insights using [Consolidation X] where applicable
4. ASSESS confidence:
   - "high": Multiple memories directly address the question
   - "medium": Some relevant memories exist but may not fully answer the question
   - "low": Limited or indirect evidence; answer is partially inferred
5. NOTE any contradictions or ambiguity in the stored preferences
6. If no relevant preferences exist, state that clearly and suggest what information might be needed

Example response format:
Q: "What are the user's UI preferences?"
A: "The user prefers dark mode across all applications [Memory 1] and favors compact, information-dense layouts [Memory 4]. They dislike animations and visual clutter [Memory 7]. A consolidation pattern confirms a strong minimalist aesthetic preference [Consolidation 2]. Confidence: high."

Rules:
- NEVER make up preferences that are not in the provided memories
- ALWAYS cite sources with memory/consolidation IDs
- Be specific and actionable in your answers
- If the question is about a topic with no stored preferences, say "No preferences found for this topic"
- Prefer recent memories over older ones when preferences may have evolved
- Include the list of source memory IDs referenced in your answer`;
```

---

## 7. LLM Integration

### 7.1 Provider Factory

**File**: `src/llm/provider-factory.ts`

The provider factory creates a LangChain.js `BaseChatModel` instance based on the application configuration. It supports three providers and throws for unknown values.

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppConfig, LlmProvider } from '../config/types.js';

/**
 * Creates a LangChain chat model instance based on the application configuration.
 *
 * @param config - Application configuration containing provider, model, and API key
 * @returns A configured BaseChatModel instance
 * @throws Error if the provider is not recognized
 */
export function createLlm(config: AppConfig): BaseChatModel {
  const { llmProvider, llmModel, llmApiKey } = config;

  switch (llmProvider) {
    case 'openai':
      return new ChatOpenAI({
        openAIApiKey: llmApiKey,
        modelName: llmModel,
        temperature: 0,
      });

    case 'anthropic':
      return new ChatAnthropic({
        anthropicApiKey: llmApiKey,
        modelName: llmModel,
        temperature: 0,
      });

    case 'google':
      return new ChatGoogleGenerativeAI({
        apiKey: llmApiKey,
        modelName: llmModel,
        temperature: 0,
      });

    default: {
      const _exhaustive: never = llmProvider;
      throw new Error(
        `Unsupported LLM provider: "${llmProvider}". ` +
        `Supported providers: openai, anthropic, google`
      );
    }
  }
}
```

### 7.2 Zod Schemas for Structured Output

**File**: `src/llm/schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Schema for IngestAgent LLM output.
 * Validates the structured metadata extracted from ingested text.
 */
export const MemoryExtractionSchema = z.object({
  summary: z
    .string()
    .describe('Concise 1-2 sentence summary focusing on the user preference or pattern'),
  entities: z
    .array(z.string())
    .describe('Key entities: people, products, features, settings, tools, categories'),
  topics: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe('2-4 lowercase hyphenated topic tags (e.g., "ui-preferences", "workflow")'),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe('Importance rating from 0.0 (trivial) to 1.0 (critical preference)'),
});

/**
 * Schema for ConsolidateAgent LLM output.
 * Validates the cross-memory patterns and connections.
 */
export const ConsolidationResultSchema = z.object({
  summary: z
    .string()
    .describe('Synthesized summary of preference patterns across the provided memories'),
  insight: z
    .string()
    .describe('One actionable insight for agents to leverage when serving this user'),
  connections: z
    .array(
      z.object({
        fromId: z.number().describe('Source memory ID'),
        toId: z.number().describe('Target memory ID'),
        relationship: z
          .string()
          .describe('Relationship type: complementary, contradictory, reinforces, evolves_from, related'),
      })
    )
    .describe('Connections between specific memories'),
});

/**
 * Schema for QueryAgent LLM output.
 * Validates the synthesized answer with citations.
 */
export const QueryResultSchema = z.object({
  answer: z
    .string()
    .describe('Synthesized answer citing memories as [Memory X] and consolidations as [Consolidation X]'),
  sourceMemoryIds: z
    .array(z.number())
    .describe('List of memory IDs referenced in the answer'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Confidence level based on available evidence'),
});
```

### 7.3 How Agents Use Structured Output

Each agent follows the same pattern to invoke the LLM with structured output:

```typescript
// Example: IngestAgent usage pattern
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemoryExtractionSchema } from '../llm/schemas.js';
import { INGEST_AGENT_SYSTEM_PROMPT } from './prompts.js';
import type { MemoryExtraction } from '../llm/types.js';

// 1. Bind the Zod schema for structured output
const structuredLlm = llm.withStructuredOutput(MemoryExtractionSchema);

// 2. Invoke with system prompt + user content
const extraction: MemoryExtraction = await structuredLlm.invoke([
  new SystemMessage(INGEST_AGENT_SYSTEM_PROMPT),
  new HumanMessage(`Analyze the following text and extract user preference metadata:\n\n${rawText}`),
]);

// 3. Result is typed and validated by Zod
// extraction.summary, extraction.entities, extraction.topics, extraction.importance
```

The `withStructuredOutput()` method from LangChain.js:
- Uses the provider's native structured output mode (function calling for OpenAI/Anthropic, or JSON mode for Google)
- Validates the response against the Zod schema at runtime
- Throws an error if the LLM response does not conform to the schema
- Returns a typed object matching the Zod schema's inferred type

### 7.4 Agent Class Structure

All three agents follow a consistent class pattern:

```typescript
export class IngestAgent {
  private readonly llm: BaseChatModel;
  private readonly memoryRepo: MemoryRepository;

  constructor(llm: BaseChatModel, memoryRepo: MemoryRepository) {
    this.llm = llm;
    this.memoryRepo = memoryRepo;
  }

  async ingest(input: IngestInput): Promise<IngestOutput> {
    // 1. Bind structured output schema
    // 2. Invoke LLM with system prompt + input text
    // 3. Build NewMemory from extraction + input
    // 4. Insert into database via repository
    // 5. Return IngestOutput with memory row + extraction
  }
}

export class ConsolidateAgent {
  private readonly llm: BaseChatModel;
  private readonly memoryRepo: MemoryRepository;
  private readonly consolidationRepo: ConsolidationRepository;

  constructor(
    llm: BaseChatModel,
    memoryRepo: MemoryRepository,
    consolidationRepo: ConsolidationRepository,
  ) { ... }

  async consolidate(): Promise<ConsolidateOutput> {
    // 1. Read unconsolidated memories from DB
    // 2. If < 2, return { consolidated: false, ... }
    // 3. Build context string from all unconsolidated memories
    // 4. Invoke LLM with structured output
    // 5. Store consolidation via ConsolidationRepository
    // 6. Mark memories as consolidated via MemoryRepository
    // 7. Update memory connections via MemoryRepository
    // 8. Return ConsolidateOutput
  }
}

export class QueryAgent {
  private readonly llm: BaseChatModel;
  private readonly memoryRepo: MemoryRepository;
  private readonly consolidationRepo: ConsolidationRepository;

  constructor(
    llm: BaseChatModel,
    memoryRepo: MemoryRepository,
    consolidationRepo: ConsolidationRepository,
  ) { ... }

  async query(question: string): Promise<QueryOutput> {
    // 1. Read all memories from DB
    // 2. Read all consolidations from DB
    // 3. Build context string with memory IDs and consolidation IDs
    // 4. Invoke LLM with system prompt + context + question
    // 5. Return QueryOutput
  }
}
```

---

## 8. Configuration

### 8.1 Configuration Parameters

All parameters are **required**. Missing any parameter causes an exception at startup. There are **no default values** and **no fallback values**.

| Parameter | Env Variable | Type | Validation | Description |
|-----------|-------------|------|------------|-------------|
| `llmProvider` | `LLM_PROVIDER` | `LlmProvider` | Must be one of: `"openai"`, `"anthropic"`, `"google"` | LLM provider identifier |
| `llmModel` | `LLM_MODEL` | `string` | Non-empty string | Model identifier (e.g., `"gpt-4"`, `"claude-sonnet-4-20250514"`, `"gemini-2.0-flash"`) |
| `llmApiKey` | `LLM_API_KEY` | `string` | Non-empty string | API key for the selected LLM provider |
| `databasePath` | `DATABASE_PATH` | `string` | Non-empty string | Path to SQLite database file |
| `watchDirectory` | `WATCH_DIRECTORY` | `string` | Non-empty string | Path to inbox directory for file watching |
| `apiPort` | `API_PORT` | `number` | Positive integer (1-65535) | HTTP server port number |
| `consolidationIntervalMs` | `CONSOLIDATION_INTERVAL_MS` | `number` | Positive integer (>= 1000) | Consolidation loop interval in milliseconds |

### 8.2 Configuration Loader

**File**: `src/config/config.ts`

```typescript
import type { AppConfig } from './types.js';
import { validateConfig } from './validation.js';

/**
 * Loads application configuration from environment variables.
 * Throws an Error for any missing or invalid configuration parameter.
 * No defaults. No fallbacks.
 *
 * @returns Validated AppConfig
 * @throws Error with a clear message naming the missing/invalid variable
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    llmProvider: getRequiredEnv('LLM_PROVIDER') as AppConfig['llmProvider'],
    llmModel: getRequiredEnv('LLM_MODEL'),
    llmApiKey: getRequiredEnv('LLM_API_KEY'),
    databasePath: getRequiredEnv('DATABASE_PATH'),
    watchDirectory: getRequiredEnv('WATCH_DIRECTORY'),
    apiPort: parseRequiredInt('API_PORT'),
    consolidationIntervalMs: parseRequiredInt('CONSOLIDATION_INTERVAL_MS'),
  };

  validateConfig(config);
  return config;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Set it before starting the application.`
    );
  }
  return value.trim();
}

function parseRequiredInt(name: string): number {
  const raw = getRequiredEnv(name);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Invalid value for environment variable ${name}: "${raw}". ` +
      `Expected an integer.`
    );
  }
  return parsed;
}
```

### 8.3 Configuration Validation

**File**: `src/config/validation.ts`

```typescript
import type { AppConfig } from './types.js';
import { VALID_LLM_PROVIDERS } from './types.js';

/**
 * Validates the loaded configuration object.
 * Throws on any invalid value.
 *
 * @param config - The loaded AppConfig to validate
 * @throws Error with a descriptive message for each validation failure
 */
export function validateConfig(config: AppConfig): void {
  // Validate LLM provider
  if (!VALID_LLM_PROVIDERS.includes(config.llmProvider)) {
    throw new Error(
      `Invalid LLM_PROVIDER: "${config.llmProvider}". ` +
      `Must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`
    );
  }

  // Validate API port range
  if (config.apiPort < 1 || config.apiPort > 65535) {
    throw new Error(
      `Invalid API_PORT: ${config.apiPort}. ` +
      `Must be between 1 and 65535.`
    );
  }

  // Validate consolidation interval
  if (config.consolidationIntervalMs < 1000) {
    throw new Error(
      `Invalid CONSOLIDATION_INTERVAL_MS: ${config.consolidationIntervalMs}. ` +
      `Must be at least 1000 (1 second).`
    );
  }
}
```

### 8.4 Example `.env` File

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4
LLM_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
DATABASE_PATH=./data/memory.db
WATCH_DIRECTORY=./inbox
API_PORT=8888
CONSOLIDATION_INTERVAL_MS=1800000
```

---

## 9. Client SDK Interface

### 9.1 MemoryClient Class

**File**: `src/client/memory-client.ts`

The `MemoryClient` is the public API that other agents import to interact with the memory system. It uses the native `fetch` API (Node.js 18+) and communicates via HTTP with the running memory agent.

```typescript
import type {
  MemoryClientConfig,
  ClientIngestResponse,
  ClientQueryResponse,
  ClientPreferencesResponse,
  ClientStatusResponse,
} from './types.js';

/**
 * Client SDK for the Always-On Memory Agent.
 *
 * Usage by external agents:
 *
 *   import { MemoryClient } from 'always-memory-on/client';
 *
 *   const memory = new MemoryClient({ baseUrl: 'http://localhost:8888' });
 *   await memory.ingest('User prefers dark mode', 'my-agent');
 *   const result = await memory.query('What are the UI preferences?');
 *   const prefs = await memory.getPreferences('ui-preferences');
 */
export class MemoryClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /**
   * @param config - Client configuration
   * @param config.baseUrl - Base URL of the memory agent HTTP API
   * @param config.timeoutMs - Optional request timeout (no default - throws if needed and not set)
   */
  constructor(config: MemoryClientConfig) {
    if (!config.baseUrl) {
      throw new Error('MemoryClient requires a baseUrl in the configuration');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /**
   * Ingest a preference or piece of information into the memory system.
   *
   * @param text - The raw text to ingest
   * @param source - Optional source identifier (e.g., the calling agent's name)
   * @returns The ingestion result including the stored memory
   */
  async ingest(text: string, source?: string): Promise<ClientIngestResponse> {
    const response = await this.post<ClientIngestResponse>('/ingest', {
      text,
      source: source ?? 'sdk',
    });
    return response;
  }

  /**
   * Query the memory system with a natural language question.
   *
   * @param question - The question to ask about stored preferences
   * @returns The synthesized answer with source citations
   */
  async query(question: string): Promise<ClientQueryResponse> {
    const encoded = encodeURIComponent(question);
    const response = await this.get<ClientQueryResponse>(`/query?q=${encoded}`);
    return response;
  }

  /**
   * Get user preferences filtered by topic/category.
   *
   * @param category - Optional topic tag to filter by (e.g., "ui-preferences")
   * @returns Matching preference memories
   */
  async getPreferences(category?: string): Promise<ClientPreferencesResponse> {
    // Implementation: fetches all memories and filters by topic on the client side.
    // In future versions, this can be optimized with a server-side filter endpoint.
    const memoriesResponse = await this.get<{ memories: Array<Record<string, unknown>> }>('/memories');

    const memories = memoriesResponse.memories;
    const filtered = category
      ? memories.filter((m) => {
          const topics: string[] = JSON.parse(m.topics as string);
          return topics.some((t) => t.includes(category));
        })
      : memories;

    return {
      preferences: filtered.map((m) => ({
        id: m.id as number,
        summary: m.summary as string,
        topics: JSON.parse(m.topics as string) as string[],
        importance: m.importance as number,
        createdAt: m.createdAt as string,
      })),
    };
  }

  /**
   * Get the current system status and statistics.
   *
   * @returns System status including memory counts and uptime
   */
  async getStatus(): Promise<ClientStatusResponse> {
    return this.get<ClientStatusResponse>('/status');
  }

  // ---- Private HTTP helpers ----

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Memory Agent API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Memory Agent API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

### 9.2 Package Exports for SDK

In `package.json`, the client SDK is exposed as a subpath export so external agents can import it:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client/index.js"
  }
}
```

Usage by external agents:

```typescript
import { MemoryClient } from 'always-memory-on/client';

const memory = new MemoryClient({ baseUrl: 'http://localhost:8888' });

// Store a preference
await memory.ingest('User prefers dark mode in all applications', 'my-agent');

// Query preferences
const result = await memory.query('What are the user UI preferences?');
console.log(result.answer);

// Get preferences by category
const uiPrefs = await memory.getPreferences('ui-preferences');
console.log(uiPrefs.preferences);

// Check system status
const status = await memory.getStatus();
console.log(`Total memories: ${status.memories}`);
```

---

## 10. Error Handling

### 10.1 Error Handling Strategy

The system follows a strict **no-fallback** error handling philosophy:

| Error Category | Strategy | Behavior |
|---------------|----------|----------|
| **Missing configuration** | Throw immediately | Application refuses to start. Error message names the missing variable. |
| **Invalid configuration** | Throw immediately | Application refuses to start. Error message describes the validation failure. |
| **Database errors** | Throw immediately | Crash on schema creation failure. Throw on write failures. |
| **LLM failures** | Throw to caller | API returns 500 with error details. Consolidation loop logs and continues. |
| **File watcher errors** | Log and continue | Individual file failures are logged; watcher continues processing other files. |
| **Consolidation loop errors** | Log and continue | Failed consolidation cycles are logged; the loop continues at next interval. |
| **HTTP request errors** | Return error response | Appropriate HTTP status code (400, 500) with structured error body. |
| **Client SDK errors** | Throw to caller | The `MemoryClient` throws errors with descriptive messages for the consuming agent to handle. |

### 10.2 Error Classes

```typescript
// src/errors.ts (optional - can use plain Error with descriptive messages)

/**
 * Standard error responses follow this shape across all endpoints.
 */
export interface ErrorResponseBody {
  error: string;
  statusCode: number;
}
```

### 10.3 Error Handling in Each Layer

**Configuration Layer** -- Fail fast, fail hard:
```typescript
// Throws at startup if LLM_PROVIDER is missing
throw new Error('Missing required environment variable: LLM_PROVIDER. Set it before starting the application.');
```

**Database Layer** -- Propagate errors:
```typescript
// Schema creation: let better-sqlite3 errors propagate
db.exec(CREATE_MEMORY_TABLE); // throws if SQL is invalid

// Repository operations: prepared statements throw on constraint violations
const stmt = db.prepare('INSERT INTO Memory ...');
stmt.run(...params); // throws on unique constraint violation, etc.
```

**LLM Layer** -- Propagate with context:
```typescript
try {
  const result = await structuredLlm.invoke(messages);
  return result;
} catch (error) {
  throw new Error(
    `LLM processing failed during ingestion: ${error instanceof Error ? error.message : String(error)}`
  );
}
```

**HTTP API Layer** -- Catch and return structured errors:
```typescript
fastify.post('/ingest', async (request, reply) => {
  try {
    const result = await ingestAgent.ingest(input);
    return reply.status(201).send({ status: 'ingested', memory: result.memory });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return reply.status(500).send({ error: `Ingestion failed: ${message}`, statusCode: 500 });
  }
});
```

**Consolidation Loop** -- Log and continue:
```typescript
setInterval(async () => {
  try {
    const result = await consolidateAgent.consolidate();
    console.log(`Consolidation cycle: ${result.consolidated ? 'completed' : 'skipped'}`);
  } catch (error) {
    console.error('Consolidation cycle failed:', error);
    // Do NOT re-throw. The loop must continue.
  }
}, config.consolidationIntervalMs);
```

**File Watcher** -- Log and continue for individual files:
```typescript
watcher.on('add', async (filePath: string) => {
  try {
    await processFile(filePath);
  } catch (error) {
    console.error(`Failed to process file ${filePath}:`, error);
    // Do NOT re-throw. Continue watching for other files.
  }
});
```

---

## 11. Lifecycle Management

### 11.1 Startup Sequence

**File**: `src/index.ts`

The application startup follows a strict sequential order. Each step depends on the previous one. If any step fails, the application exits immediately with a non-zero exit code.

```
STARTUP SEQUENCE
================

Step 1: Load Configuration
    |-- Read all environment variables
    |-- Validate all parameters (type, range, allowed values)
    |-- FAIL: Throw Error naming the missing/invalid variable -> Exit(1)
    |
Step 2: Initialize Database
    |-- Open SQLite connection at config.databasePath
    |-- Execute all CREATE TABLE IF NOT EXISTS statements
    |-- Execute all CREATE INDEX IF NOT EXISTS statements
    |-- Instantiate all three repositories
    |-- FAIL: Throw Error with SQLite error details -> Exit(1)
    |
Step 3: Create LLM Instance
    |-- Call createLlm(config) via provider factory
    |-- FAIL: Throw Error if provider is unsupported -> Exit(1)
    |
Step 4: Create Agent Instances
    |-- IngestAgent(llm, memoryRepo)
    |-- ConsolidateAgent(llm, memoryRepo, consolidationRepo)
    |-- QueryAgent(llm, memoryRepo, consolidationRepo)
    |
Step 5: Start HTTP Server
    |-- Create Fastify instance
    |-- Register all route plugins with agent/repo dependencies
    |-- Listen on config.apiPort
    |-- FAIL: Throw Error if port is in use -> Exit(1)
    |
Step 6: Start File Watcher
    |-- Create inbox directory if it does not exist
    |-- Initialize Chokidar watcher on config.watchDirectory
    |-- Register 'add' event handler (with dedup via ProcessedFileRepo)
    |-- FAIL: Log error but do not exit (watcher is non-critical at startup)
    |
Step 7: Start Consolidation Loop
    |-- Start setInterval timer at config.consolidationIntervalMs
    |-- First consolidation runs after the first interval (not immediately)
    |
Step 8: Log Ready
    |-- Log: "Always-On Memory Agent started"
    |-- Log: "  HTTP API: http://localhost:{port}"
    |-- Log: "  Watching: {watchDirectory}"
    |-- Log: "  Database: {databasePath}"
    |-- Log: "  LLM: {provider}/{model}"
    |-- Log: "  Consolidation interval: {intervalMs}ms"
    |
Step 9: Register Signal Handlers
    |-- SIGINT  -> gracefulShutdown()
    |-- SIGTERM -> gracefulShutdown()
```

### 11.2 Shutdown Sequence

```
SHUTDOWN SEQUENCE (triggered by SIGINT or SIGTERM)
==================================================

Step 1: Log "Shutting down..."
    |
Step 2: Stop Consolidation Loop
    |-- clearInterval(timer)
    |-- Log "Consolidation loop stopped"
    |
Step 3: Stop File Watcher
    |-- await watcher.close()
    |-- Log "File watcher stopped"
    |
Step 4: Stop HTTP Server
    |-- await fastify.close()
    |-- Log "HTTP server stopped"
    |
Step 5: Close Database
    |-- db.close()
    |-- Log "Database connection closed"
    |
Step 6: Log "Shutdown complete"
    |
Step 7: process.exit(0)
```

### 11.3 Implementation Pattern

```typescript
// src/index.ts

import { loadConfig } from './config/index.js';
import { initializeDatabase, closeDatabase } from './database/index.js';
import { MemoryRepository, ConsolidationRepository, ProcessedFileRepository } from './database/index.js';
import { createLlm } from './llm/index.js';
import { IngestAgent, ConsolidateAgent, QueryAgent } from './agents/index.js';
import { createServer, startServer, stopServer } from './api/index.js';
import { FileWatcher } from './watcher/index.js';
import { ConsolidationLoop } from './consolidation/index.js';

async function main(): Promise<void> {
  // Step 1: Load configuration (throws on missing)
  const config = loadConfig();
  console.log('Configuration loaded successfully');

  // Step 2: Initialize database
  const db = initializeDatabase(config.databasePath);
  const memoryRepo = new MemoryRepository(db);
  const consolidationRepo = new ConsolidationRepository(db);
  const processedFileRepo = new ProcessedFileRepository(db);
  console.log(`Database initialized: ${config.databasePath}`);

  // Step 3: Create LLM instance
  const llm = createLlm(config);
  console.log(`LLM configured: ${config.llmProvider}/${config.llmModel}`);

  // Step 4: Create agents
  const ingestAgent = new IngestAgent(llm, memoryRepo);
  const consolidateAgent = new ConsolidateAgent(llm, memoryRepo, consolidationRepo);
  const queryAgent = new QueryAgent(llm, memoryRepo, consolidationRepo);

  // Step 5: Start HTTP server
  const server = createServer({ ingestAgent, consolidateAgent, queryAgent, memoryRepo, consolidationRepo });
  await startServer(server, config.apiPort);
  console.log(`HTTP API listening on http://localhost:${config.apiPort}`);

  // Step 6: Start file watcher
  const fileWatcher = new FileWatcher(config.watchDirectory, ingestAgent, processedFileRepo);
  fileWatcher.start();
  console.log(`Watching directory: ${config.watchDirectory}`);

  // Step 7: Start consolidation loop
  const consolidationLoop = new ConsolidationLoop(consolidateAgent, config.consolidationIntervalMs);
  consolidationLoop.start();
  console.log(`Consolidation loop: every ${config.consolidationIntervalMs}ms`);

  // Step 8: Log ready
  const startTime = Date.now();
  console.log('Always-On Memory Agent started successfully');

  // Step 9: Register signal handlers
  const gracefulShutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down...`);

    consolidationLoop.stop();
    console.log('Consolidation loop stopped');

    fileWatcher.stop();
    console.log('File watcher stopped');

    await stopServer(server);
    console.log('HTTP server stopped');

    closeDatabase(db);
    console.log('Database connection closed');

    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
  process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
}

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
```

---

## 12. Parallel Implementation Units

### 12.1 Dependency Graph

```
Unit A: Configuration (no dependencies)
    |
    +-----> Unit B: Database Layer (depends on A)
    |           |
    +-----> Unit C: LLM Layer (depends on A)
    |           |
    |           +-----> Unit D: Agent Layer (depends on B + C)
    |                       |
    |                       +-----> Unit E: HTTP API (depends on D)
    |                       |
    |                       +-----> Unit F: File Watcher (depends on D + B)
    |                       |
    |                       +-----> Unit G: Consolidation Loop (depends on D)
    |
    +-----> Unit H: Client SDK (depends only on types -- no runtime dependency)
```

### 12.2 Implementation Units and Parallelism

The following table identifies which units can be developed in parallel by different developers/agents:

| Unit | Files | Can Start After | Can Parallel With | Estimated Effort |
|------|-------|----------------|-------------------|------------------|
| **A: Configuration** | `src/config/*` | Nothing | Nothing (first) | 1-2 hours |
| **B: Database** | `src/database/*` | Unit A | Unit C, Unit H | 2-3 hours |
| **C: LLM Layer** | `src/llm/*` | Unit A | Unit B, Unit H | 1-2 hours |
| **D: Agents** | `src/agents/*` | Units B + C | Unit H | 3-4 hours |
| **E: HTTP API** | `src/api/*` | Unit D | Units F, G | 2-3 hours |
| **F: File Watcher** | `src/watcher/*` | Unit D | Units E, G | 1-2 hours |
| **G: Consolidation Loop** | `src/consolidation/*` | Unit D | Units E, F | 1 hour |
| **H: Client SDK** | `src/client/*` | Unit A (types only) | Units B, C, D, E, F, G | 1-2 hours |
| **I: Integration** | `src/index.ts` | All above | Nothing (last) | 1-2 hours |

### 12.3 Parallel Tracks

**Track 1** (Critical Path): A -> B -> D -> E -> I
**Track 2** (Parallel to B): A -> C (merges into D)
**Track 3** (Parallel to E): D -> F (merges into I)
**Track 4** (Parallel to E): D -> G (merges into I)
**Track 5** (Independent): A -> H (needs only type definitions)

**Maximum parallelism after Unit A is complete**:
- Three developers can work simultaneously on B, C, and H
- After B and C complete, three developers can work on E, F, and G (after D is done)

### 12.4 Interface Contracts Between Units

For parallel development to work, the following interfaces must be agreed upon before development begins (they are defined in this document):

| Producer Unit | Consumer Unit | Interface |
|--------------|--------------|-----------|
| A (Config) | All | `AppConfig` interface |
| B (Database) | D (Agents) | `MemoryRepository`, `ConsolidationRepository`, `ProcessedFileRepository` classes |
| B (Database) | D (Agents) | `MemoryRow`, `ConsolidationRow`, `NewMemory`, `NewConsolidation` types |
| C (LLM) | D (Agents) | `createLlm()` function, `BaseChatModel` type |
| C (LLM) | D (Agents) | `MemoryExtractionSchema`, `ConsolidationResultSchema`, `QueryResultSchema` Zod schemas |
| D (Agents) | E (API) | `IngestAgent`, `ConsolidateAgent`, `QueryAgent` classes |
| D (Agents) | F (Watcher) | `IngestAgent` class |
| D (Agents) | G (Loop) | `ConsolidateAgent` class |
| E (API) | H (Client) | HTTP endpoint contracts (Section 4) |

### 12.5 Testing Strategy Per Unit

| Unit | Test Type | Test Framework | Mock Requirements |
|------|-----------|---------------|-------------------|
| A | Unit test | Vitest | Mock `process.env` |
| B | Integration test | Vitest | In-memory SQLite (`:memory:`) |
| C | Unit test | Vitest | No LLM calls; test instantiation only |
| D | Unit test + Integration | Vitest | Mock LLM via LangChain FakeListChatModel; real SQLite |
| E | Integration test | Vitest + Fastify inject | Mock agents |
| F | Integration test | Vitest | Mock IngestAgent; real file system (temp directory) |
| G | Unit test | Vitest | Mock ConsolidateAgent; fake timers |
| H | Unit test | Vitest | Mock HTTP via undici MockAgent or MSW |
| I | E2E test | Vitest | Real LLM (or FakeListChatModel); real SQLite |

---

## Appendix A: Package Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/core` | latest | Core LangChain abstractions |
| `@langchain/openai` | latest | OpenAI provider integration |
| `@langchain/anthropic` | latest | Anthropic Claude provider integration |
| `@langchain/google-genai` | latest | Google Gemini provider integration |
| `better-sqlite3` | ^12.x | SQLite database driver |
| `fastify` | ^5.x | HTTP server framework |
| `chokidar` | ^4.x | File system watcher |
| `zod` | ^3.x | Runtime schema validation for LLM output |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.9 | TypeScript compiler |
| `tsx` | latest | TypeScript runner with watch mode |
| `@types/node` | ^22.x | Node.js type definitions |
| `@types/better-sqlite3` | latest | better-sqlite3 type definitions |
| `vitest` | latest | Test runner |

---

## Appendix B: TypeScript Compiler Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "types": ["node"],
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests", "test_scripts"]
}
```

Key settings:
- **`strict: true`**: Enables all strict type-checking options
- **`noUncheckedIndexedAccess: true`**: Forces checking for `undefined` on indexed access
- **`exactOptionalPropertyTypes: true`**: Distinguishes between `undefined` and missing
- **`module: NodeNext`**: ESM module support with `.js` extension requirements
- **`declaration: true`**: Generates `.d.ts` files for the client SDK

---

## Appendix C: .gitignore

```
# Build output
dist/

# Dependencies
node_modules/

# Database files
*.db
*.db-journal
*.db-wal

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log

# Test artifacts
coverage/
test-*.db
```

---

## Appendix D: Naming Conventions Summary

| Domain | Convention | Example |
|--------|-----------|---------|
| Database tables | Singular PascalCase | `Memory`, `Consolidation`, `ProcessedFile` |
| Database columns | camelCase | `userId`, `rawText`, `createdAt` |
| TypeScript files | kebab-case | `ingest-agent.ts`, `memory-repository.ts` |
| TypeScript interfaces | PascalCase | `MemoryRow`, `AppConfig`, `IngestInput` |
| TypeScript classes | PascalCase | `IngestAgent`, `MemoryClient` |
| TypeScript functions | camelCase | `loadConfig()`, `createLlm()` |
| TypeScript constants | UPPER_SNAKE_CASE or camelCase | `VALID_LLM_PROVIDERS`, `SUPPORTED_EXTENSIONS` |
| Environment variables | UPPER_SNAKE_CASE | `LLM_PROVIDER`, `DATABASE_PATH` |
| API endpoints | lowercase with slashes | `/status`, `/memories`, `/query` |
| Topic tags | lowercase hyphenated | `ui-preferences`, `development-tools` |
