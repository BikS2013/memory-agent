/**
 * Factory function that creates a complete SQL Server storage bundle.
 * Returns all three repositories and a close() handle.
 */

import sql from 'mssql';
import type { SqlServerConfig } from '../../config/types.js';
import type { StorageBundle } from '../interfaces.js';
import { initializeSqlServerSchema } from './sqlserver-schema.js';
import { SqlServerMemoryRepository } from './sqlserver-memory-repository.js';
import { SqlServerConsolidationRepository } from './sqlserver-consolidation-repository.js';
import { SqlServerProcessedFileRepository } from './sqlserver-processed-file-repository.js';

/**
 * Creates a SQL Server-backed StorageBundle from the given configuration.
 *
 * Establishes a connection pool, initializes the database schema (idempotent),
 * creates all three repository instances, and returns the bundle.
 *
 * @param config - SQL Server configuration with all required connection fields.
 * @returns A StorageBundle with all repositories and a close() method that drains the pool.
 */
export async function createSqlServerStorage(config: SqlServerConfig): Promise<StorageBundle> {
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

  // Initialize schema (idempotent - tables created only if they don't exist)
  await initializeSqlServerSchema(pool);

  const memoryRepo = new SqlServerMemoryRepository(pool);
  const consolidationRepo = new SqlServerConsolidationRepository(pool);
  const processedFileRepo = new SqlServerProcessedFileRepository(pool);

  return {
    memoryRepo,
    consolidationRepo,
    processedFileRepo,
    async close(): Promise<void> {
      await pool.close();
    },
  };
}
