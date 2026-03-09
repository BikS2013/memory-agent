/**
 * Barrel exports for the SQL Server storage backend.
 */

export {
  CREATE_MEMORY_TABLE_DDL,
  CREATE_CONSOLIDATION_TABLE_DDL,
  CREATE_PROCESSED_FILE_TABLE_DDL,
  initializeSqlServerSchema,
} from './sqlserver-schema.js';
export { SqlServerMemoryRepository } from './sqlserver-memory-repository.js';
export { SqlServerConsolidationRepository } from './sqlserver-consolidation-repository.js';
export { SqlServerProcessedFileRepository } from './sqlserver-processed-file-repository.js';
export { createSqlServerStorage } from './create-sqlserver-storage.js';
