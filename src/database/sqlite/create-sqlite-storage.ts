/**
 * Factory function that creates a complete SQLite storage bundle.
 * Returns all three repositories and a close() handle.
 */

import type { SqliteConfig } from '../../config/types.js';
import type { StorageBundle } from '../interfaces.js';
import { initializeDatabase, closeDatabase } from './sqlite-connection.js';
import { SqliteMemoryRepository } from './sqlite-memory-repository.js';
import { SqliteConsolidationRepository } from './sqlite-consolidation-repository.js';
import { SqliteProcessedFileRepository } from './sqlite-processed-file-repository.js';

/**
 * Creates a SQLite-backed StorageBundle from the given configuration.
 *
 * @param config - SQLite configuration containing the database path.
 * @returns A StorageBundle with all repositories and a close() method.
 */
export async function createSqliteStorage(config: SqliteConfig): Promise<StorageBundle> {
  const db = initializeDatabase(config.databasePath);

  const memoryRepo = new SqliteMemoryRepository(db);
  const consolidationRepo = new SqliteConsolidationRepository(db);
  const processedFileRepo = new SqliteProcessedFileRepository(db);

  return {
    memoryRepo,
    consolidationRepo,
    processedFileRepo,
    async close(): Promise<void> {
      closeDatabase(db);
    },
  };
}
