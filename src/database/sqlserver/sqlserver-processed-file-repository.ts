/**
 * SQL Server implementation of the IProcessedFileRepository interface.
 * Uses parameterized queries via mssql connection pool for all operations.
 */

import sql from 'mssql';
import type { ProcessedFileRow } from '../types.js';
import type { IProcessedFileRepository } from '../interfaces.js';

export class SqlServerProcessedFileRepository implements IProcessedFileRepository {
  constructor(private readonly pool: sql.ConnectionPool) {}

  /**
   * Checks whether a file has already been processed.
   * Returns true if a row with the given filePath exists, false otherwise.
   */
  async isProcessed(filePath: string): Promise<boolean> {
    const result = await this.pool
      .request()
      .input('path', sql.NVarChar, filePath)
      .query('SELECT 1 AS found FROM ProcessedFile WHERE filePath = @path');

    return result.recordset.length > 0;
  }

  /**
   * Marks a file as processed with the current timestamp.
   * Idempotent: uses MERGE to handle duplicate filePath gracefully.
   */
  async markProcessed(filePath: string): Promise<void> {
    const processedAt = new Date().toISOString();

    await this.pool
      .request()
      .input('path', sql.NVarChar, filePath)
      .input('processedAt', sql.NVarChar, processedAt)
      .query(`
        MERGE ProcessedFile AS target
        USING (SELECT @path AS filePath) AS source
        ON target.filePath = source.filePath
        WHEN NOT MATCHED THEN
          INSERT (filePath, processedAt)
          VALUES (@path, @processedAt);
      `);
  }

  /**
   * Returns all processed file rows ordered by id ascending.
   */
  async getAll(): Promise<ProcessedFileRow[]> {
    const result = await this.pool
      .request()
      .query('SELECT * FROM ProcessedFile ORDER BY id ASC');

    return result.recordset as ProcessedFileRow[];
  }
}
