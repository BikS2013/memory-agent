/**
 * Barrel exports for the SQLite storage backend.
 */

export { initializeDatabase, closeDatabase } from './sqlite-connection.js';
export { SqliteMemoryRepository } from './sqlite-memory-repository.js';
export { SqliteConsolidationRepository } from './sqlite-consolidation-repository.js';
export { SqliteProcessedFileRepository } from './sqlite-processed-file-repository.js';
export { createSqliteStorage } from './create-sqlite-storage.js';
