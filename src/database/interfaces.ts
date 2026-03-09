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
