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

---

## Enhancement: Multi-Storage Backend & YAML Configuration

**Version**: 2.0 Addendum
**Created**: 2026-03-09
**Status**: Approved for Implementation
**Prerequisite Documents**:
- [Refined Request](../reference/refined-request-multi-storage-llm-config.md)
- [Plan 002](./plan-002-multi-storage-llm-config.md)
- [Technical Investigation](../reference/investigation-multi-storage-llm-config.md)

### Table of Contents (Addendum)

1. [E1. YAML Configuration Schemas](#e1-yaml-configuration-schemas)
2. [E2. Repository Interfaces](#e2-repository-interfaces)
3. [E3. Restructured AppConfig](#e3-restructured-appconfig)
4. [E4. SQLite Backend Refactor](#e4-sqlite-backend-refactor)
5. [E5. SQL Server Backend](#e5-sql-server-backend)
6. [E6. Azure Blob Storage Backend](#e6-azure-blob-storage-backend)
7. [E7. Storage Factory](#e7-storage-factory)
8. [E8. Updated LLM Factory](#e8-updated-llm-factory)
9. [E9. Updated Module Organization](#e9-updated-module-organization)
10. [E10. Parallel Implementation Units](#e10-parallel-implementation-units)

---

### E1. YAML Configuration Schemas

Both YAML configuration files are loaded at startup, parsed with `js-yaml`, and validated with Zod. The path to each file is read from a mandatory environment variable. Missing env vars or invalid YAML content causes an immediate startup exception with a descriptive message.

#### E1.1 Storage Configuration Schema (`storage-config.yaml`)

**Environment variable**: `STORAGE_CONFIG_PATH` (absolute path, required, no fallback)

**YAML structure**:

```yaml
storage:
  provider: "sqlite" | "sqlserver" | "azure-blob"
  sqlite:
    databasePath: "./data/memories.db"
  sqlserver:
    server: "localhost"
    port: 1433
    database: "MemoryAgent"
    user: "sa"
    password: "secret"
    encrypt: true
    trustServerCertificate: false
  azure-blob:
    authMethod: "connection-string" | "azure-identity"
    connectionString: "DefaultEndpointsProtocol=https;..."
    accountName: "mystorageaccount"
    containerName: "memories"
    timePeriodFormat: "monthly" | "weekly" | "daily"
```

**Complete Zod schema**:

```typescript
import { z } from 'zod';

// --- Sub-schemas for each storage provider ---

const sqliteConfigSchema = z.object({
  databasePath: z.string().min(1, 'sqlite.databasePath is required'),
});

const sqlServerConfigSchema = z.object({
  server: z.string().min(1, 'sqlserver.server is required'),
  port: z.number().int().min(1).max(65535, 'sqlserver.port must be 1-65535'),
  database: z.string().min(1, 'sqlserver.database is required'),
  user: z.string().min(1, 'sqlserver.user is required'),
  password: z.string().min(1, 'sqlserver.password is required'),
  encrypt: z.boolean({ required_error: 'sqlserver.encrypt is required' }),
  trustServerCertificate: z.boolean({
    required_error: 'sqlserver.trustServerCertificate is required',
  }),
});

const azureBlobConfigSchema = z
  .object({
    authMethod: z.enum(['connection-string', 'azure-identity'], {
      required_error:
        'azure-blob.authMethod must be "connection-string" or "azure-identity"',
    }),
    connectionString: z.string().min(1).optional(),
    accountName: z.string().min(1).optional(),
    containerName: z.string().min(1, 'azure-blob.containerName is required'),
    timePeriodFormat: z.enum(['monthly', 'weekly', 'daily'], {
      required_error:
        'azure-blob.timePeriodFormat must be "monthly", "weekly", or "daily"',
    }),
  })
  .refine(
    (data) => {
      if (data.authMethod === 'connection-string') {
        return (
          data.connectionString !== undefined &&
          data.connectionString.length > 0
        );
      }
      return true;
    },
    {
      message:
        'azure-blob.connectionString is required when authMethod is "connection-string"',
      path: ['connectionString'],
    }
  )
  .refine(
    (data) => {
      if (data.authMethod === 'azure-identity') {
        return data.accountName !== undefined && data.accountName.length > 0;
      }
      return true;
    },
    {
      message:
        'azure-blob.accountName is required when authMethod is "azure-identity"',
      path: ['accountName'],
    }
  );

// --- Top-level storage config schema with conditional validation ---

const storageProviderEnum = z.enum(['sqlite', 'sqlserver', 'azure-blob']);

export const storageConfigSchema = z
  .object({
    storage: z.object({
      provider: storageProviderEnum,
      sqlite: sqliteConfigSchema.optional(),
      sqlserver: sqlServerConfigSchema.optional(),
      'azure-blob': azureBlobConfigSchema.optional(),
    }),
  })
  .refine(
    (data) => {
      const p = data.storage.provider;
      if (p === 'sqlite') return data.storage.sqlite !== undefined;
      if (p === 'sqlserver') return data.storage.sqlserver !== undefined;
      if (p === 'azure-blob') return data.storage['azure-blob'] !== undefined;
      return false;
    },
    {
      message:
        'The configuration section for the active storage provider is missing. ' +
        'Ensure the YAML contains the section matching the selected provider.',
    }
  );

export type StorageConfigYaml = z.infer<typeof storageConfigSchema>;
```

**Conditional validation logic**: Only the section matching the active `provider` value is required to be present and valid. Sections for inactive providers may be absent entirely. When a provider section is present but the provider is not active, it is parsed but not enforced (allows keeping templates in the file).

**Azure Blob dual auth**: The `authMethod` field controls which credential fields are required:
- `"connection-string"`: requires `connectionString`
- `"azure-identity"`: requires `accountName` (uses `DefaultAzureCredential` from `@azure/identity`)

#### E1.2 LLM Configuration Schema (`llm-config.yaml`)

**Environment variable**: `LLM_CONFIG_PATH` (absolute path, required, no fallback)

**YAML structure**:

```yaml
llm:
  provider: "openai" | "anthropic" | "google"
  temperature: 0.0
  model: "gpt-4"
  openai:
    apiKey: "sk-..."
    organization: "org-..."    # OPTIONAL - exception to no-fallback rule
    baseUrl: "https://..."     # OPTIONAL - exception to no-fallback rule
  anthropic:
    apiKey: "sk-ant-..."
    baseUrl: "https://..."     # OPTIONAL - exception to no-fallback rule
  google:
    apiKey: "AIza..."
```

**Complete Zod schema**:

```typescript
import { z } from 'zod';

// --- Sub-schemas for each LLM provider ---

const openaiProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'openai.apiKey is required'),
  organization: z.string().min(1).optional(), // OPTIONAL: exception to no-fallback rule
  baseUrl: z.string().url().optional(),        // OPTIONAL: exception to no-fallback rule
});

const anthropicProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'anthropic.apiKey is required'),
  baseUrl: z.string().url().optional(), // OPTIONAL: exception to no-fallback rule
});

const googleProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'google.apiKey is required'),
});

// --- Top-level LLM config schema with conditional validation ---

const llmProviderEnum = z.enum(['openai', 'anthropic', 'google']);

export const llmConfigSchema = z
  .object({
    llm: z.object({
      provider: llmProviderEnum,
      temperature: z
        .number({ required_error: 'llm.temperature is required' })
        .min(0.0, 'temperature must be >= 0.0')
        .max(2.0, 'temperature must be <= 2.0'),
      model: z.string().min(1, 'llm.model is required'),
      openai: openaiProviderConfigSchema.optional(),
      anthropic: anthropicProviderConfigSchema.optional(),
      google: googleProviderConfigSchema.optional(),
    }),
  })
  .refine(
    (data) => {
      const p = data.llm.provider;
      if (p === 'openai') return data.llm.openai !== undefined;
      if (p === 'anthropic') return data.llm.anthropic !== undefined;
      if (p === 'google') return data.llm.google !== undefined;
      return false;
    },
    {
      message:
        'The configuration section for the active LLM provider is missing. ' +
        'Ensure the YAML contains the section matching the selected provider.',
    }
  );

export type LlmConfigYaml = z.infer<typeof llmConfigSchema>;
```

**Optional fields exception**: The fields `organization`, `baseUrl` (OpenAI), and `baseUrl` (Anthropic) are explicitly optional. This is an approved exception to the project-wide no-fallback rule. When absent, they are simply not passed to the LangChain constructor. This exception is documented in the project memory.

#### E1.3 YAML Loader Utility

```typescript
// src/config/yaml-loader.ts
import * as fs from 'node:fs';
import * as yaml from 'js-yaml';

/**
 * Reads a YAML file from disk and returns the parsed content as unknown.
 * Throws if the file does not exist or contains invalid YAML.
 *
 * @param filePath - Absolute path to the YAML file
 * @returns Parsed YAML content (unknown type, to be validated by Zod)
 */
export function loadYamlFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `YAML configuration file not found: ${filePath}. ` +
        `Verify the path specified in the corresponding environment variable.`
    );
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content);
  if (parsed === null || parsed === undefined) {
    throw new Error(
      `YAML configuration file is empty or invalid: ${filePath}`
    );
  }
  return parsed;
}
```

---

### E2. Repository Interfaces

All repository interfaces use `Promise<T>` return types to support async storage backends (SQL Server, Azure Blob). The SQLite backend wraps its synchronous better-sqlite3 calls in `async` functions for interface consistency. This is the central abstraction that enables backend-agnostic consumer code.

#### E2.1 IMemoryRepository

```typescript
// src/database/interfaces.ts

import type {
  MemoryRow,
  NewMemory,
  ConnectionEntry,
  MemoryStats,
  ConsolidationRow,
  NewConsolidation,
  ProcessedFileRow,
} from './types.js';

/**
 * Async interface for Memory table operations.
 * All storage backends (SQLite, SQL Server, Azure Blob) implement this interface.
 */
export interface IMemoryRepository {
  /**
   * Inserts a new memory. Generates id, createdAt, and defaults automatically.
   * userId defaults to 'default' if not provided in the input.
   */
  insert(memory: NewMemory): Promise<MemoryRow>;

  /**
   * Returns all memory rows ordered by id ascending.
   */
  getAll(): Promise<MemoryRow[]>;

  /**
   * Returns a single memory row by id, or undefined if not found.
   */
  getById(id: number): Promise<MemoryRow | undefined>;

  /**
   * Returns all memory rows where consolidated = 0, ordered by id ascending.
   */
  getUnconsolidated(): Promise<MemoryRow[]>;

  /**
   * Marks the specified memory ids as consolidated (consolidated = 1).
   * Must be atomic: either all ids are marked or none.
   */
  markConsolidated(ids: number[]): Promise<void>;

  /**
   * Replaces the connections JSON field for a specific memory.
   */
  updateConnections(id: number, connections: ConnectionEntry[]): Promise<void>;

  /**
   * Deletes a memory row by id. Returns true if a row was deleted.
   */
  deleteById(id: number): Promise<boolean>;

  /**
   * Deletes all memory rows. Returns the count of rows deleted.
   */
  deleteAll(): Promise<number>;

  /**
   * Returns aggregate statistics: total, consolidated, unconsolidated, consolidations count.
   */
  getStats(): Promise<MemoryStats>;
}
```

#### E2.2 IConsolidationRepository

```typescript
/**
 * Async interface for Consolidation table operations.
 */
export interface IConsolidationRepository {
  /**
   * Inserts a new consolidation. Generates id and createdAt automatically.
   */
  insert(consolidation: NewConsolidation): Promise<ConsolidationRow>;

  /**
   * Returns all consolidation rows ordered by id ascending.
   */
  getAll(): Promise<ConsolidationRow[]>;

  /**
   * Deletes all consolidation rows. Returns the count of rows deleted.
   */
  deleteAll(): Promise<number>;

  /**
   * Returns the total number of consolidation rows.
   */
  getCount(): Promise<number>;
}
```

#### E2.3 IProcessedFileRepository

```typescript
/**
 * Async interface for ProcessedFile table operations.
 */
export interface IProcessedFileRepository {
  /**
   * Returns true if the file at the given path has already been processed.
   */
  isProcessed(filePath: string): Promise<boolean>;

  /**
   * Records the file as processed with a current timestamp.
   * Idempotent: calling again for the same path is a no-op.
   */
  markProcessed(filePath: string): Promise<void>;

  /**
   * Returns all processed file rows ordered by id ascending.
   */
  getAll(): Promise<ProcessedFileRow[]>;
}
```

#### E2.4 StorageBundle

```typescript
/**
 * Groups all three repository instances and a close() handle
 * into a single object returned by the StorageFactory.
 *
 * Consumers receive this bundle and destructure the repos they need.
 * The close() method must be called during graceful shutdown.
 */
export interface StorageBundle {
  readonly memoryRepo: IMemoryRepository;
  readonly consolidationRepo: IConsolidationRepository;
  readonly processedFileRepo: IProcessedFileRepository;

  /**
   * Releases all resources held by the storage backend.
   * - SQLite: closes the database file handle
   * - SQL Server: drains and closes the connection pool
   * - Azure Blob: no-op (HTTP-based, no persistent connection)
   */
  close(): Promise<void>;
}
```

---

### E3. Restructured AppConfig

The monolithic `AppConfig` interface is replaced with a structured hierarchy. Storage and LLM configuration come from YAML files; operational settings remain as environment variables.

#### E3.1 Complete Type Definitions

```typescript
// src/config/types.ts (replacement)

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
  readonly connectionString?: string;
  /** Required when authMethod = 'azure-identity' */
  readonly accountName?: string;
  readonly containerName: string;
  readonly timePeriodFormat: TimePeriodFormat;
}

/**
 * Discriminated union for storage configuration.
 * The `provider` field determines which sub-config is guaranteed present.
 */
export interface StorageConfig {
  readonly provider: StorageProvider;
  readonly sqlite?: SqliteConfig;
  readonly sqlserver?: SqlServerConfig;
  readonly 'azure-blob'?: AzureBlobConfig;
}

// =====================================================================
// LLM Provider Types
// =====================================================================

export type LlmProvider = 'openai' | 'anthropic' | 'google';

export interface OpenAiProviderConfig {
  readonly apiKey: string;
  /** OPTIONAL: exception to no-fallback rule */
  readonly organization?: string;
  /** OPTIONAL: exception to no-fallback rule. For Azure OpenAI or custom endpoints. */
  readonly baseUrl?: string;
}

export interface AnthropicProviderConfig {
  readonly apiKey: string;
  /** OPTIONAL: exception to no-fallback rule. For custom endpoints. */
  readonly baseUrl?: string;
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
  readonly openai?: OpenAiProviderConfig;
  readonly anthropic?: AnthropicProviderConfig;
  readonly google?: GoogleProviderConfig;
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
```

#### E3.2 Environment Variables (Final State)

| Variable | Purpose | Required |
|----------|---------|----------|
| `STORAGE_CONFIG_PATH` | Absolute path to `storage-config.yaml` | Yes, no fallback |
| `LLM_CONFIG_PATH` | Absolute path to `llm-config.yaml` | Yes, no fallback |
| `WATCH_DIRECTORY` | Path to the inbox directory for file watcher | Yes, no fallback |
| `API_PORT` | HTTP server port number | Yes, no fallback |
| `CONSOLIDATION_INTERVAL_MS` | Timer interval for consolidation loop (ms) | Yes, no fallback |

**Removed**: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `DATABASE_PATH`

#### E3.3 Updated loadConfig()

```typescript
// src/config/config.ts (updated)
import { loadYamlFile } from './yaml-loader.js';
import { storageConfigSchema } from './storage-config-schema.js';
import { llmConfigSchema } from './llm-config-schema.js';
import type { AppConfig } from './types.js';

export function loadConfig(): AppConfig {
  // 1. Read mandatory env var paths
  const storageConfigPath = process.env.STORAGE_CONFIG_PATH;
  if (!storageConfigPath) {
    throw new Error(
      'Environment variable STORAGE_CONFIG_PATH is not set. ' +
        'It must contain the absolute path to storage-config.yaml.'
    );
  }

  const llmConfigPath = process.env.LLM_CONFIG_PATH;
  if (!llmConfigPath) {
    throw new Error(
      'Environment variable LLM_CONFIG_PATH is not set. ' +
        'It must contain the absolute path to llm-config.yaml.'
    );
  }

  // 2. Load and validate YAML files
  const rawStorage = loadYamlFile(storageConfigPath);
  const storageResult = storageConfigSchema.safeParse(rawStorage);
  if (!storageResult.success) {
    throw new Error(
      `Invalid storage-config.yaml at ${storageConfigPath}:\n` +
        storageResult.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }

  const rawLlm = loadYamlFile(llmConfigPath);
  const llmResult = llmConfigSchema.safeParse(rawLlm);
  if (!llmResult.success) {
    throw new Error(
      `Invalid llm-config.yaml at ${llmConfigPath}:\n` +
        llmResult.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n')
    );
  }

  // 3. Read remaining env vars (no fallbacks)
  const watchDirectory = process.env.WATCH_DIRECTORY;
  if (!watchDirectory) {
    throw new Error('Environment variable WATCH_DIRECTORY is not set.');
  }

  const apiPortStr = process.env.API_PORT;
  if (!apiPortStr) {
    throw new Error('Environment variable API_PORT is not set.');
  }
  const apiPort = parseInt(apiPortStr, 10);
  if (isNaN(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error(
      `API_PORT must be an integer between 1 and 65535. Got: "${apiPortStr}"`
    );
  }

  const intervalStr = process.env.CONSOLIDATION_INTERVAL_MS;
  if (!intervalStr) {
    throw new Error(
      'Environment variable CONSOLIDATION_INTERVAL_MS is not set.'
    );
  }
  const consolidationIntervalMs = parseInt(intervalStr, 10);
  if (isNaN(consolidationIntervalMs) || consolidationIntervalMs < 1000) {
    throw new Error(
      `CONSOLIDATION_INTERVAL_MS must be an integer >= 1000. Got: "${intervalStr}"`
    );
  }

  // 4. Assemble and return
  return {
    storage: storageResult.data.storage,
    llm: llmResult.data.llm,
    watchDirectory,
    apiPort,
    consolidationIntervalMs,
  };
}
```

---

### E4. SQLite Backend Refactor

The existing synchronous better-sqlite3 repositories are moved into `src/database/sqlite/` and refactored to implement the async interfaces. No behavioral changes -- only structural reorganization and `async` wrapping.

#### E4.1 File Moves

| Current Location | New Location |
|------------------|--------------|
| `src/database/memory-repository.ts` | `src/database/sqlite/sqlite-memory-repository.ts` |
| `src/database/consolidation-repository.ts` | `src/database/sqlite/sqlite-consolidation-repository.ts` |
| `src/database/processed-file-repository.ts` | `src/database/sqlite/sqlite-processed-file-repository.ts` |
| `src/database/connection.ts` | `src/database/sqlite/connection.ts` |
| `src/database/schema.ts` | `src/database/sqlite/schema.ts` |

The original files in `src/database/` are deleted after the move.

#### E4.2 Async Wrapping Pattern

Since better-sqlite3 is synchronous, each method is declared `async` and the synchronous return value is implicitly wrapped in a resolved `Promise`. No explicit `Promise.resolve()` is needed.

```typescript
// src/database/sqlite/sqlite-memory-repository.ts

import type Database from 'better-sqlite3';
import type { IMemoryRepository } from '../interfaces.js';
import type {
  MemoryRow,
  NewMemory,
  ConnectionEntry,
  MemoryStats,
} from '../types.js';

export class SqliteMemoryRepository implements IMemoryRepository {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly getUnconsolidatedStmt: Database.Statement;
  private readonly updateConnectionsStmt: Database.Statement;
  private readonly deleteByIdStmt: Database.Statement;
  private readonly deleteAllStmt: Database.Statement;
  private readonly totalCountStmt: Database.Statement;
  private readonly consolidatedCountStmt: Database.Statement;
  private readonly consolidationsCountStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    // Prepared statements are identical to the current implementation
    this.insertStmt = db.prepare(`
      INSERT INTO Memory (userId, source, rawText, summary, entities,
                          topics, importance, consolidated, connections, createdAt)
      VALUES (@userId, @source, @rawText, @summary, @entities,
              @topics, @importance, 0, '[]', @createdAt)
    `);
    this.getAllStmt = db.prepare('SELECT * FROM Memory ORDER BY id ASC');
    this.getByIdStmt = db.prepare('SELECT * FROM Memory WHERE id = ?');
    this.getUnconsolidatedStmt = db.prepare(
      'SELECT * FROM Memory WHERE consolidated = 0 ORDER BY id ASC'
    );
    this.updateConnectionsStmt = db.prepare(
      'UPDATE Memory SET connections = ? WHERE id = ?'
    );
    this.deleteByIdStmt = db.prepare('DELETE FROM Memory WHERE id = ?');
    this.deleteAllStmt = db.prepare('DELETE FROM Memory');
    this.totalCountStmt = db.prepare('SELECT COUNT(*) AS count FROM Memory');
    this.consolidatedCountStmt = db.prepare(
      'SELECT COUNT(*) AS count FROM Memory WHERE consolidated = 1'
    );
    this.consolidationsCountStmt = db.prepare(
      'SELECT COUNT(*) AS count FROM Consolidation'
    );
  }

  async insert(memory: NewMemory): Promise<MemoryRow> {
    const params = {
      userId: memory.userId ?? 'default',
      source: memory.source,
      rawText: memory.rawText,
      summary: memory.summary,
      entities: memory.entities,
      topics: memory.topics,
      importance: memory.importance,
      createdAt: new Date().toISOString(),
    };
    const result = this.insertStmt.run(params);
    return this.getByIdStmt.get(Number(result.lastInsertRowid)) as MemoryRow;
  }

  async getAll(): Promise<MemoryRow[]> {
    return this.getAllStmt.all() as MemoryRow[];
  }

  async getById(id: number): Promise<MemoryRow | undefined> {
    return this.getByIdStmt.get(id) as MemoryRow | undefined;
  }

  async getUnconsolidated(): Promise<MemoryRow[]> {
    return this.getUnconsolidatedStmt.all() as MemoryRow[];
  }

  async markConsolidated(ids: number[]): Promise<void> {
    const markStmt = this.db.prepare(
      'UPDATE Memory SET consolidated = 1 WHERE id = ?'
    );
    const transaction = this.db.transaction((memoryIds: number[]) => {
      for (const id of memoryIds) {
        markStmt.run(id);
      }
    });
    transaction(ids);
  }

  async updateConnections(
    id: number,
    connections: ConnectionEntry[]
  ): Promise<void> {
    this.updateConnectionsStmt.run(JSON.stringify(connections), id);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = this.deleteByIdStmt.run(id);
    return result.changes > 0;
  }

  async deleteAll(): Promise<number> {
    const result = this.deleteAllStmt.run();
    return result.changes;
  }

  async getStats(): Promise<MemoryStats> {
    const total = (this.totalCountStmt.get() as { count: number }).count;
    const consolidated = (
      this.consolidatedCountStmt.get() as { count: number }
    ).count;
    const consolidations = (
      this.consolidationsCountStmt.get() as { count: number }
    ).count;
    return {
      total,
      consolidated,
      unconsolidated: total - consolidated,
      consolidations,
    };
  }
}
```

The `SqliteConsolidationRepository` and `SqliteProcessedFileRepository` follow the same pattern: identical logic to the current classes, declared `async`, implementing `IConsolidationRepository` and `IProcessedFileRepository` respectively.

#### E4.3 SQLite Connection Module

```typescript
// src/database/sqlite/connection.ts
import Database from 'better-sqlite3';
import { ALL_SCHEMA_STATEMENTS } from './schema.js';

export function initializeSqliteDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  for (const statement of ALL_SCHEMA_STATEMENTS) {
    db.exec(statement);
  }
  return db;
}

export function closeSqliteDatabase(db: Database.Database): void {
  db.close();
}
```

The schema file (`src/database/sqlite/schema.ts`) is moved as-is from `src/database/schema.ts` with no changes.

---

### E5. SQL Server Backend

#### E5.1 Schema DDL

```sql
-- src/database/sqlserver/schema.ts (exported as string constants)

-- Memory table
IF OBJECT_ID('dbo.Memory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Memory (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    userId              NVARCHAR(255)   NOT NULL DEFAULT 'default',
    source              NVARCHAR(MAX)   NOT NULL,
    rawText             NVARCHAR(MAX)   NOT NULL,
    summary             NVARCHAR(MAX)   NOT NULL,
    entities            NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    topics              NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    importance          FLOAT           NOT NULL DEFAULT 0.0,
    consolidated        BIT             NOT NULL DEFAULT 0,
    connections         NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    createdAt           NVARCHAR(50)    NOT NULL,
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
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    userId              NVARCHAR(255)   NOT NULL,
    sourceIds           NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    summary             NVARCHAR(MAX)   NOT NULL,
    insight             NVARCHAR(MAX)   NOT NULL,
    createdAt           NVARCHAR(50)    NOT NULL
  );

  CREATE INDEX idx_consolidation_userId ON dbo.Consolidation(userId);
END

-- ProcessedFile table
IF OBJECT_ID('dbo.ProcessedFile', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProcessedFile (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    filePath            NVARCHAR(1000)  NOT NULL,
    processedAt         NVARCHAR(50)    NOT NULL,
    CONSTRAINT UQ_ProcessedFile_filePath UNIQUE (filePath)
  );
END
```

**Key differences from SQLite**:
- `INTEGER` becomes `INT IDENTITY(1,1)` for auto-increment
- `TEXT` becomes `NVARCHAR(MAX)` for Unicode support
- `REAL` becomes `FLOAT`
- `INTEGER` (boolean) becomes `BIT`
- `CREATE TABLE IF NOT EXISTS` becomes `IF OBJECT_ID(...) IS NULL BEGIN ... END`
- `INSERT OR IGNORE` becomes `MERGE` or `IF NOT EXISTS` pattern

#### E5.2 Connection Pool Setup

```typescript
// src/database/sqlserver/connection.ts
import * as sql from 'mssql';
import type { SqlServerConfig } from '../../config/types.js';
import {
  CREATE_MEMORY_TABLE_DDL,
  CREATE_CONSOLIDATION_TABLE_DDL,
  CREATE_PROCESSED_FILE_TABLE_DDL,
} from './schema.js';

export async function initializeSqlServerDatabase(
  config: SqlServerConfig
): Promise<sql.ConnectionPool> {
  const poolConfig: sql.config = {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
    },
  };

  const pool = new sql.ConnectionPool(poolConfig);
  await pool.connect();

  // Run schema initialization
  const request = pool.request();
  await request.batch(CREATE_MEMORY_TABLE_DDL);
  await request.batch(CREATE_CONSOLIDATION_TABLE_DDL);
  await request.batch(CREATE_PROCESSED_FILE_TABLE_DDL);

  return pool;
}

export async function closeSqlServerDatabase(
  pool: sql.ConnectionPool
): Promise<void> {
  await pool.close();
}
```

#### E5.3 Repository Implementation Pattern

All SQL Server repositories use parameterized queries via `.input()` for SQL injection prevention. Example for `SqlServerMemoryRepository.insert()`:

```typescript
// src/database/sqlserver/sqlserver-memory-repository.ts
import * as sql from 'mssql';
import type { IMemoryRepository } from '../interfaces.js';
import type { MemoryRow, NewMemory, ConnectionEntry, MemoryStats } from '../types.js';

export class SqlServerMemoryRepository implements IMemoryRepository {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async insert(memory: NewMemory): Promise<MemoryRow> {
    const createdAt = new Date().toISOString();
    const userId = memory.userId ?? 'default';

    const result = await this.pool
      .request()
      .input('userId', sql.NVarChar, userId)
      .input('source', sql.NVarChar, memory.source)
      .input('rawText', sql.NVarChar, memory.rawText)
      .input('summary', sql.NVarChar, memory.summary)
      .input('entities', sql.NVarChar, memory.entities)
      .input('topics', sql.NVarChar, memory.topics)
      .input('importance', sql.Float, memory.importance)
      .input('createdAt', sql.NVarChar, createdAt)
      .query(`
        INSERT INTO Memory (userId, source, rawText, summary, entities,
                            topics, importance, consolidated, connections, createdAt)
        OUTPUT INSERTED.*
        VALUES (@userId, @source, @rawText, @summary, @entities,
                @topics, @importance, 0, '[]', @createdAt)
      `);

    return this.mapRow(result.recordset[0]);
  }

  async markConsolidated(ids: number[]): Promise<void> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin();
    try {
      for (const id of ids) {
        await transaction
          .request()
          .input('id', sql.Int, id)
          .query('UPDATE Memory SET consolidated = 1 WHERE id = @id');
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getStats(): Promise<MemoryStats> {
    const result = await this.pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN consolidated = 1 THEN 1 ELSE 0 END) AS consolidated,
        (SELECT COUNT(*) FROM Consolidation) AS consolidations
      FROM Memory
    `);
    const row = result.recordset[0];
    return {
      total: row.total,
      consolidated: row.consolidated,
      unconsolidated: row.total - row.consolidated,
      consolidations: row.consolidations,
    };
  }

  // ... remaining methods follow the same parameterized query pattern

  /**
   * Maps a SQL Server recordset row to MemoryRow.
   * Handles BIT -> number conversion for the consolidated field.
   */
  private mapRow(row: Record<string, unknown>): MemoryRow {
    return {
      id: row.id as number,
      userId: row.userId as string,
      source: row.source as string,
      rawText: row.rawText as string,
      summary: row.summary as string,
      entities: row.entities as string,
      topics: row.topics as string,
      importance: row.importance as number,
      consolidated: (row.consolidated as boolean) ? 1 : 0,
      connections: row.connections as string,
      createdAt: row.createdAt as string,
    };
  }
}
```

**Key patterns**:
- `OUTPUT INSERTED.*` replaces the SQLite pattern of running a separate SELECT after INSERT
- `sql.Transaction` wraps `markConsolidated()` for atomicity
- `mapRow()` normalizes SQL Server `BIT` (boolean) to the `number` (0/1) that `MemoryRow` expects
- `SqlServerConsolidationRepository` and `SqlServerProcessedFileRepository` follow the same parameterized query pattern

---

### E6. Azure Blob Storage Backend

#### E6.1 Blob Naming Convention

```
{userId}/{timePeriod}/memories.json          -- Array<MemoryRow>
{userId}/{timePeriod}/consolidations.json    -- Array<ConsolidationRow>
{userId}/processed-files.json                -- Array<ProcessedFileRow>
```

**Time period formats** (based on `timePeriodFormat` config):

| Format | Pattern | Example |
|--------|---------|---------|
| `monthly` | `YYYY-MM` | `2026-03` |
| `weekly` | `YYYY-Www` | `2026-W10` |
| `daily` | `YYYY-MM-DD` | `2026-03-09` |

**ProcessedFile exception**: Not time-bucketed because file processing tracking is not time-scoped. Stored as a single blob per user.

**Example blob paths** for user "john" in March 2026 (monthly):
```
john/2026-03/memories.json
john/2026-03/consolidations.json
john/processed-files.json
```

#### E6.2 JSON Blob Structure

Each blob contains a JSON array of the corresponding row type:

```json
// john/2026-03/memories.json
[
  {
    "id": 1,
    "userId": "john",
    "source": "api",
    "rawText": "...",
    "summary": "...",
    "entities": "[\"entity1\"]",
    "topics": "[\"topic1\"]",
    "importance": 0.8,
    "consolidated": 0,
    "connections": "[]",
    "createdAt": "2026-03-09T10:30:00.000Z"
  }
]
```

JSON fields (`entities`, `topics`, `connections`, `sourceIds`) remain as serialized JSON strings within the blob JSON, matching the SQLite/SQL Server column representation. This ensures `MemoryRow` and `ConsolidationRow` types are used consistently across all backends.

#### E6.3 Connection Initialization

```typescript
// src/database/azure-blob/connection.ts
import {
  BlobServiceClient,
  ContainerClient,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { AzureBlobConfig } from '../../config/types.js';

export async function initializeAzureBlobStorage(
  config: AzureBlobConfig
): Promise<ContainerClient> {
  let blobServiceClient: BlobServiceClient;

  switch (config.authMethod) {
    case 'connection-string': {
      blobServiceClient = BlobServiceClient.fromConnectionString(
        config.connectionString!
      );
      break;
    }
    case 'azure-identity': {
      const credential = new DefaultAzureCredential();
      const accountUrl = `https://${config.accountName!}.blob.core.windows.net`;
      blobServiceClient = new BlobServiceClient(accountUrl, credential);
      break;
    }
    default: {
      const _exhaustive: never = config.authMethod;
      throw new Error(`Unsupported auth method: ${config.authMethod}`);
    }
  }

  const containerClient = blobServiceClient.getContainerClient(
    config.containerName
  );
  await containerClient.createIfNotExists();
  return containerClient;
}
```

#### E6.4 Read-Modify-Write with ETags

```typescript
// src/database/azure-blob/blob-helpers.ts
import type {
  BlockBlobClient,
  ContainerClient,
  BlobDownloadResponseParsed,
} from '@azure/storage-blob';

const MAX_RETRIES = 3;

interface BlobReadResult<T> {
  items: T[];
  etag: string | undefined;
}

/**
 * Reads a JSON blob. Returns empty array if the blob does not exist.
 */
export async function readJsonBlob<T>(
  blockBlobClient: BlockBlobClient
): Promise<BlobReadResult<T>> {
  try {
    const response: BlobDownloadResponseParsed =
      await blockBlobClient.download(0);
    const body = await streamToString(response.readableStreamBody!);
    const items = JSON.parse(body) as T[];
    return { items, etag: response.etag };
  } catch (error: unknown) {
    if (isBlobNotFoundError(error)) {
      return { items: [], etag: undefined };
    }
    throw error;
  }
}

/**
 * Writes a JSON blob with optional ETag condition for optimistic concurrency.
 */
export async function writeJsonBlob<T>(
  blockBlobClient: BlockBlobClient,
  items: T[],
  etag?: string
): Promise<void> {
  const content = JSON.stringify(items, null, 2);
  const conditions = etag ? { ifMatch: etag } : {};
  await blockBlobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions,
  });
}

/**
 * Atomic read-modify-write with ETag-based optimistic concurrency.
 * Retries up to MAX_RETRIES times on ETag mismatch (HTTP 412).
 */
export async function readModifyWrite<T>(
  blockBlobClient: BlockBlobClient,
  modifier: (items: T[]) => T[]
): Promise<T[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { items, etag } = await readJsonBlob<T>(blockBlobClient);
    const modified = modifier(items);
    try {
      await writeJsonBlob(blockBlobClient, modified, etag);
      return modified;
    } catch (error: unknown) {
      if (isEtagMismatchError(error) && attempt < MAX_RETRIES - 1) {
        continue; // Retry with fresh read
      }
      throw error;
    }
  }
  throw new Error(
    `readModifyWrite failed after ${MAX_RETRIES} retries due to concurrent modifications`
  );
}

/**
 * Generates the time-period key for the current date.
 */
export function generateTimePeriodKey(
  format: 'monthly' | 'weekly' | 'daily'
): string {
  const now = new Date();
  switch (format) {
    case 'monthly':
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    case 'weekly': {
      const weekNumber = getISOWeekNumber(now);
      return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    }
    case 'daily':
      return now.toISOString().slice(0, 10);
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported time period format: ${format}`);
    }
  }
}

/**
 * Lists all time-period prefixes for a given user by listing blobs.
 * Used for cross-period scanning (getAll, getUnconsolidated).
 */
export async function listTimePeriodPrefixes(
  containerClient: ContainerClient,
  userId: string,
  dataType: string
): Promise<string[]> {
  const prefixes: string[] = [];
  const prefix = `${userId}/`;
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith(`/${dataType}.json`)) {
      prefixes.push(blob.name);
    }
  }
  return prefixes;
}

function isBlobNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: number }).statusCode === 404
  );
}

function isEtagMismatchError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: number }).statusCode === 412
  );
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

async function streamToString(
  stream: NodeJS.ReadableStream
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
```

#### E6.5 Cross-Period Scanning

Operations that need all data across time periods (`getAll()`, `getUnconsolidated()`, `getStats()`, `deleteAll()`) must scan multiple blobs.

**Strategy**: List all blobs matching `{userId}/*/memories.json`, read each, merge results.

```typescript
// In AzureBlobMemoryRepository:

async getAll(): Promise<MemoryRow[]> {
  const blobPaths = await listTimePeriodPrefixes(
    this.containerClient,
    this.userId,
    'memories'
  );
  const allMemories: MemoryRow[] = [];
  for (const blobPath of blobPaths) {
    const client = this.containerClient.getBlockBlobClient(blobPath);
    const { items } = await readJsonBlob<MemoryRow>(client);
    allMemories.push(...items);
  }
  return allMemories.sort((a, b) => a.id - b.id);
}

async getUnconsolidated(): Promise<MemoryRow[]> {
  const all = await this.getAll();
  return all.filter((m) => m.consolidated === 0);
}

async markConsolidated(ids: number[]): Promise<void> {
  const idSet = new Set(ids);
  const blobPaths = await listTimePeriodPrefixes(
    this.containerClient,
    this.userId,
    'memories'
  );
  for (const blobPath of blobPaths) {
    const client = this.containerClient.getBlockBlobClient(blobPath);
    await readModifyWrite<MemoryRow>(client, (memories) =>
      memories.map((m) =>
        idSet.has(m.id) ? { ...m, consolidated: 1 } : m
      )
    );
  }
}
```

**Performance note**: Cross-period scanning reads all period blobs sequentially. For the initial implementation this is acceptable. An index blob optimization (maintaining a global index of memory IDs to their period blobs) is deferred to a future enhancement.

#### E6.6 Auto-ID Generation

Since Azure Blob Storage has no auto-increment facility, IDs are generated by finding the maximum existing ID across all period blobs and adding 1:

```typescript
private async getNextId(): Promise<number> {
  const allMemories = await this.getAll();
  if (allMemories.length === 0) return 1;
  return Math.max(...allMemories.map((m) => m.id)) + 1;
}
```

This approach is safe for single-agent deployment. Under concurrent access, the ETag-based read-modify-write pattern prevents duplicate IDs.

---

### E7. Storage Factory

The `StorageFactory` reads the `storage` section of the validated config and instantiates the correct backend, returning a `StorageBundle`.

```typescript
// src/database/storage-factory.ts
import type { StorageConfig } from '../config/types.js';
import type { StorageBundle } from './interfaces.js';

// SQLite imports
import { initializeSqliteDatabase, closeSqliteDatabase } from './sqlite/connection.js';
import { SqliteMemoryRepository } from './sqlite/sqlite-memory-repository.js';
import { SqliteConsolidationRepository } from './sqlite/sqlite-consolidation-repository.js';
import { SqliteProcessedFileRepository } from './sqlite/sqlite-processed-file-repository.js';

// SQL Server imports
import {
  initializeSqlServerDatabase,
  closeSqlServerDatabase,
} from './sqlserver/connection.js';
import { SqlServerMemoryRepository } from './sqlserver/sqlserver-memory-repository.js';
import { SqlServerConsolidationRepository } from './sqlserver/sqlserver-consolidation-repository.js';
import { SqlServerProcessedFileRepository } from './sqlserver/sqlserver-processed-file-repository.js';

// Azure Blob imports
import { initializeAzureBlobStorage } from './azure-blob/connection.js';
import { AzureBlobMemoryRepository } from './azure-blob/azure-blob-memory-repository.js';
import { AzureBlobConsolidationRepository } from './azure-blob/azure-blob-consolidation-repository.js';
import { AzureBlobProcessedFileRepository } from './azure-blob/azure-blob-processed-file-repository.js';

export class StorageFactory {
  /**
   * Creates the storage bundle for the configured provider.
   * Initializes connections/containers and returns all three repos + close handle.
   *
   * @throws Error if the provider is unsupported or connection fails.
   */
  static async create(config: StorageConfig): Promise<StorageBundle> {
    switch (config.provider) {
      case 'sqlite': {
        const sqliteConfig = config.sqlite!; // Guaranteed by Zod validation
        const db = initializeSqliteDatabase(sqliteConfig.databasePath);
        return {
          memoryRepo: new SqliteMemoryRepository(db),
          consolidationRepo: new SqliteConsolidationRepository(db),
          processedFileRepo: new SqliteProcessedFileRepository(db),
          close: async () => closeSqliteDatabase(db),
        };
      }

      case 'sqlserver': {
        const sqlServerConfig = config.sqlserver!; // Guaranteed by Zod validation
        const pool = await initializeSqlServerDatabase(sqlServerConfig);
        return {
          memoryRepo: new SqlServerMemoryRepository(pool),
          consolidationRepo: new SqlServerConsolidationRepository(pool),
          processedFileRepo: new SqlServerProcessedFileRepository(pool),
          close: async () => await closeSqlServerDatabase(pool),
        };
      }

      case 'azure-blob': {
        const blobConfig = config['azure-blob']!; // Guaranteed by Zod validation
        const containerClient = await initializeAzureBlobStorage(blobConfig);
        return {
          memoryRepo: new AzureBlobMemoryRepository(
            containerClient,
            blobConfig
          ),
          consolidationRepo: new AzureBlobConsolidationRepository(
            containerClient,
            blobConfig
          ),
          processedFileRepo: new AzureBlobProcessedFileRepository(
            containerClient
          ),
          close: async () => {
            /* No-op: Azure Blob is HTTP-based, no persistent connection */
          },
        };
      }

      default: {
        const _exhaustive: never = config.provider;
        throw new Error(
          `Unsupported storage provider: "${config.provider}". ` +
            `Supported providers: sqlite, sqlserver, azure-blob`
        );
      }
    }
  }
}
```

**Usage in `src/index.ts`**:

```typescript
const config = loadConfig();
const storage = await StorageFactory.create(config.storage);
const { memoryRepo, consolidationRepo, processedFileRepo } = storage;

// ... wire repos into agents, routes, watcher ...

// Graceful shutdown
process.on('SIGINT', async () => {
  await storage.close();
  process.exit(0);
});
```

---

### E8. Updated LLM Factory

The `createLlm()` function is updated to accept `LlmConfig` instead of the flat `AppConfig`. Temperature is read from config (no longer hardcoded to 0). Optional fields (`organization`, `baseUrl`) are conditionally passed.

```typescript
// src/llm/provider-factory.ts (updated)
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LlmConfig } from '../config/types.js';

/**
 * Creates a LangChain chat model instance from the YAML-sourced LLM configuration.
 *
 * @param llmConfig - LLM configuration from llm-config.yaml (validated by Zod)
 * @returns A configured BaseChatModel instance
 * @throws Error if the provider is not recognized
 */
export function createLlm(llmConfig: LlmConfig): BaseChatModel {
  switch (llmConfig.provider) {
    case 'openai': {
      const openaiConfig = llmConfig.openai!; // Guaranteed by Zod conditional validation
      return new ChatOpenAI({
        openAIApiKey: openaiConfig.apiKey,
        modelName: llmConfig.model,
        temperature: llmConfig.temperature,
        ...(openaiConfig.organization && {
          configuration: {
            organization: openaiConfig.organization,
          },
        }),
        ...(openaiConfig.baseUrl && {
          configuration: {
            ...(openaiConfig.organization && {
              organization: openaiConfig.organization,
            }),
            baseURL: openaiConfig.baseUrl,
          },
        }),
      });
    }

    case 'anthropic': {
      const anthropicConfig = llmConfig.anthropic!; // Guaranteed by Zod conditional validation
      return new ChatAnthropic({
        anthropicApiKey: anthropicConfig.apiKey,
        modelName: llmConfig.model,
        temperature: llmConfig.temperature,
        ...(anthropicConfig.baseUrl && {
          clientOptions: { baseURL: anthropicConfig.baseUrl },
        }),
      });
    }

    case 'google': {
      const googleConfig = llmConfig.google!; // Guaranteed by Zod conditional validation
      return new ChatGoogleGenerativeAI({
        apiKey: googleConfig.apiKey,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
      });
    }

    default: {
      const _exhaustive: never = llmConfig.provider;
      throw new Error(
        `Unsupported LLM provider: "${(llmConfig as { provider: string }).provider}". ` +
          `Supported providers: openai, anthropic, google`
      );
    }
  }
}
```

**Changes from v1.0**:
- Parameter: `AppConfig` replaced by `LlmConfig`
- Temperature: `llmConfig.temperature` replaces hardcoded `0`
- Optional `organization`: passed in `configuration` object when present
- Optional `baseUrl` (OpenAI): passed as `configuration.baseURL` when present
- Optional `baseUrl` (Anthropic): passed as `clientOptions.baseURL` when present
- Call site changes: `createLlm(config)` becomes `createLlm(config.llm)`

---

### E9. Updated Module Organization

#### E9.1 New File Tree

```
src/
├── config/
│   ├── config.ts                              # MODIFIED: loads YAML + env vars
│   ├── llm-config-schema.ts                   # NEW: Zod schema for llm-config.yaml
│   ├── storage-config-schema.ts               # NEW: Zod schema for storage-config.yaml
│   ├── types.ts                               # MODIFIED: StorageConfig, LlmConfig, AppConfig
│   ├── validation.ts                          # MODIFIED: validates new AppConfig structure
│   ├── yaml-loader.ts                         # NEW: generic YAML file loader
│   └── index.ts                               # MODIFIED: exports new types/schemas
│
├── database/
│   ├── interfaces.ts                          # NEW: IMemoryRepository, IConsolidationRepository,
│   │                                          #       IProcessedFileRepository, StorageBundle
│   ├── types.ts                               # UNCHANGED: MemoryRow, NewMemory, etc.
│   ├── storage-factory.ts                     # NEW: StorageFactory.create()
│   │
│   ├── sqlite/
│   │   ├── connection.ts                      # MOVED from src/database/connection.ts
│   │   ├── schema.ts                          # MOVED from src/database/schema.ts
│   │   ├── sqlite-memory-repository.ts        # NEW: async wrapper of old MemoryRepository
│   │   ├── sqlite-consolidation-repository.ts # NEW: async wrapper of old ConsolidationRepository
│   │   ├── sqlite-processed-file-repository.ts# NEW: async wrapper of old ProcessedFileRepository
│   │   └── index.ts                           # NEW: barrel export
│   │
│   ├── sqlserver/
│   │   ├── connection.ts                      # NEW: pool init/close
│   │   ├── schema.ts                          # NEW: SQL Server DDL
│   │   ├── sqlserver-memory-repository.ts     # NEW: parameterized query implementation
│   │   ├── sqlserver-consolidation-repository.ts # NEW
│   │   ├── sqlserver-processed-file-repository.ts # NEW
│   │   └── index.ts                           # NEW: barrel export
│   │
│   ├── azure-blob/
│   │   ├── connection.ts                      # NEW: container client init
│   │   ├── blob-helpers.ts                    # NEW: readJsonBlob, writeJsonBlob,
│   │   │                                      #       readModifyWrite, time period utils
│   │   ├── azure-blob-memory-repository.ts    # NEW: blob-based implementation
│   │   ├── azure-blob-consolidation-repository.ts # NEW
│   │   ├── azure-blob-processed-file-repository.ts # NEW
│   │   └── index.ts                           # NEW: barrel export
│   │
│   └── index.ts                               # MODIFIED: exports interfaces, factory, sub-modules
│
├── llm/
│   ├── provider-factory.ts                    # MODIFIED: accepts LlmConfig
│   ├── types.ts                               # UNCHANGED
│   ├── schemas.ts                             # UNCHANGED
│   └── index.ts                               # MODIFIED: updated exports
│
├── agents/
│   ├── ingest-agent.ts                        # MODIFIED: uses IMemoryRepository, async calls
│   ├── consolidate-agent.ts                   # MODIFIED: uses IMemoryRepository, IConsolidationRepository
│   ├── query-agent.ts                         # MODIFIED: uses IMemoryRepository, IConsolidationRepository
│   └── index.ts                               # MODIFIED
│
├── api/
│   ├── routes.ts                              # MODIFIED: await on all repo calls
│   ├── types.ts                               # MODIFIED: references interface types
│   ├── server.ts                              # MODIFIED: minor type updates
│   └── index.ts                               # UNCHANGED
│
├── watcher/
│   ├── file-watcher.ts                        # MODIFIED: uses IProcessedFileRepository, await
│   └── index.ts                               # UNCHANGED
│
├── consolidation/
│   ├── consolidation-loop.ts                  # MODIFIED: verify async compatibility
│   └── index.ts                               # UNCHANGED
│
└── index.ts                                   # MODIFIED: uses StorageFactory, new config
```

#### E9.2 Deleted Files

| File | Reason |
|------|--------|
| `src/database/memory-repository.ts` | Replaced by `src/database/sqlite/sqlite-memory-repository.ts` |
| `src/database/consolidation-repository.ts` | Replaced by `src/database/sqlite/sqlite-consolidation-repository.ts` |
| `src/database/processed-file-repository.ts` | Replaced by `src/database/sqlite/sqlite-processed-file-repository.ts` |
| `src/database/connection.ts` | Replaced by `src/database/sqlite/connection.ts` |
| `src/database/schema.ts` | Replaced by `src/database/sqlite/schema.ts` |

#### E9.3 New npm Dependencies

| Package | Dev? | Purpose |
|---------|------|---------|
| `js-yaml` | No | YAML file parsing |
| `@types/js-yaml` | Yes | TypeScript definitions for js-yaml |
| `mssql` | No | SQL Server client with connection pooling |
| `@types/mssql` | Yes | TypeScript definitions for mssql |
| `@azure/storage-blob` | No | Azure Blob Storage SDK |
| `@azure/identity` | No | Azure Identity (DefaultAzureCredential) for azure-identity auth method |

---

### E10. Parallel Implementation Units

The implementation is organized into units that can be built and verified independently, respecting the dependency graph from Plan 002.

#### E10.1 Dependency Graph

```
Unit A: YAML Config Infra ──────────┬──────> Unit D: LLM Factory Update
                                    │
Unit B: Repository Interfaces ──────┤
                                    │
                                    ├──────> Unit C: SQLite Async Refactor
                                    │               │
                                    │               v
                                    ├──────> Unit E: Consumer Async Migration
                                    │               │
                                    │               v
                                    ├──────> Unit F: SQL Server Backend ──────┐
                                    │                                        │
                                    └──────> Unit G: Azure Blob Backend ─────┤
                                                                             │
                                                                             v
                                                                      Unit H: Storage Factory
                                                                             │
                                                                             v
                                                                      Unit I: Tests
```

#### E10.2 Parallel Groups

| Group | Units | Can Run In Parallel | Rationale |
|-------|-------|---------------------|-----------|
| **Group 1** | A + B | Yes | YAML infrastructure and interface definitions have no shared dependencies |
| **Group 2** | C (needs B) + D (needs A) | Yes | SQLite refactor needs interfaces; LLM factory needs config types. These are independent of each other |
| **Group 3** | F + G (both need E) | Yes | SQL Server and Azure Blob backends are fully independent implementations of the same interfaces |

#### E10.3 Unit Descriptions

| Unit | Name | Input | Output | Estimated Effort |
|------|------|-------|--------|------------------|
| A | YAML Config Infrastructure | None | `yaml-loader.ts`, `storage-config-schema.ts`, `llm-config-schema.ts`, updated `types.ts`, `config.ts` | Small |
| B | Repository Interface Definitions | None | `interfaces.ts` with all interfaces and `StorageBundle` | Small |
| C | SQLite Async Refactor | Unit B | `src/database/sqlite/` directory with all files, old files deleted | Medium |
| D | LLM Factory Update | Unit A | Updated `provider-factory.ts` accepting `LlmConfig` | Small |
| E | Consumer Async Migration | Units C + D | All agents, routes, watcher updated with `await` and interface types | Medium-Large |
| F | SQL Server Backend | Unit B + Unit E | `src/database/sqlserver/` directory with all files | Medium-Large |
| G | Azure Blob Storage Backend | Unit B + Unit E | `src/database/azure-blob/` directory with all files | Large |
| H | Storage Factory + Integration | Units F + G | `storage-factory.ts`, updated `src/index.ts` | Small |
| I | Tests | Unit H | Test scripts in `test_scripts/` with YAML fixtures | Medium-Large |

#### E10.4 Critical Path

The critical path through the dependency graph is:

**B -> C -> E -> G -> H -> I**

This is the longest chain because Azure Blob (Unit G) is the most complex backend. SQL Server (Unit F) can run in parallel with G and is not on the critical path.

#### E10.5 First Full-System Checkpoint

After completing Units A + B + C + D + E, the application must be fully functional with the SQLite backend via `storage-config.yaml`. This is the first integration checkpoint before adding new backends. All HTTP endpoints, file watcher, and consolidation loop must work identically to v1.0 behavior.

---

### E11. Configuration Exception Registry

Per project rules, optional fields that constitute exceptions to the no-fallback rule must be documented before implementation.

| Field | Location | Type | Rationale |
|-------|----------|------|-----------|
| `llm.openai.organization` | `llm-config.yaml` | `string \| undefined` | Not all OpenAI accounts use organizations. Omitting means "use default organization." |
| `llm.openai.baseUrl` | `llm-config.yaml` | `string \| undefined` | Only needed for Azure OpenAI or custom endpoints. Standard OpenAI API does not require it. |
| `llm.anthropic.baseUrl` | `llm-config.yaml` | `string \| undefined` | Only needed for custom/proxy endpoints. Standard Anthropic API does not require it. |
| `storage.azure-blob.connectionString` | `storage-config.yaml` | `string \| undefined` | Conditionally required: only when `authMethod = "connection-string"`. |
| `storage.azure-blob.accountName` | `storage-config.yaml` | `string \| undefined` | Conditionally required: only when `authMethod = "azure-identity"`. |

These exceptions are approved by user decision and must be recorded in the project memory file before implementation begins.
