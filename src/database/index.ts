/**
 * Barrel exports for the database layer.
 */

export type {
  MemoryRow,
  NewMemory,
  ConsolidationRow,
  NewConsolidation,
  ProcessedFileRow,
  ConnectionEntry,
  MemoryStats,
} from './types.js';

export {
  CREATE_MEMORY_TABLE,
  CREATE_CONSOLIDATION_TABLE,
  CREATE_PROCESSED_FILE_TABLE,
  CREATE_MEMORY_USER_ID_INDEX,
  CREATE_MEMORY_CONSOLIDATED_INDEX,
  CREATE_MEMORY_IMPORTANCE_INDEX,
  CREATE_CONSOLIDATION_USER_ID_INDEX,
  ALL_SCHEMA_STATEMENTS,
} from './schema.js';

export { initializeDatabase, closeDatabase } from './connection.js';

export { MemoryRepository } from './memory-repository.js';
export { ConsolidationRepository } from './consolidation-repository.js';
export { ProcessedFileRepository } from './processed-file-repository.js';
