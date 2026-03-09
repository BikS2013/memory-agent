/**
 * Database row types and related interfaces for the Always-On Memory Agent.
 * JSON fields (entities, topics, connections, sourceIds) are stored as TEXT strings in SQLite.
 */

/**
 * Represents a row in the Memory table exactly as stored in SQLite.
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
 * The `id` is auto-generated. `consolidated` defaults to 0.
 * `connections` defaults to '[]'. `createdAt` is auto-generated.
 * `userId` defaults to 'default' if not provided.
 */
export interface NewMemory {
  readonly userId?: string;
  readonly source: string;
  readonly rawText: string;
  readonly summary: string;
  /** JSON-serialized string[] */
  readonly entities: string;
  /** JSON-serialized string[] */
  readonly topics: string;
  readonly importance: number;
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
 * The `id` is auto-generated. `createdAt` is auto-generated.
 */
export interface NewConsolidation {
  readonly userId: string;
  /** JSON-serialized number[] */
  readonly sourceIds: string;
  readonly summary: string;
  readonly insight: string;
}

/**
 * Represents a row in the ProcessedFile table.
 */
export interface ProcessedFileRow {
  readonly id: number;
  readonly filePath: string;
  /** ISO 8601 timestamp */
  readonly processedAt: string;
}

/**
 * A connection between memories, stored in the connections JSON field.
 */
export interface ConnectionEntry {
  readonly type: string;
  readonly targetId: number;
  readonly description: string;
}

/**
 * Memory statistics returned by the repository.
 */
export interface MemoryStats {
  readonly total: number;
  readonly consolidated: number;
  readonly unconsolidated: number;
  readonly consolidations: number;
}
