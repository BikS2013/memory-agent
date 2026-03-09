/**
 * SQL Server implementation of the IConsolidationRepository interface.
 * Uses parameterized queries via mssql connection pool for all operations.
 */

import sql from 'mssql';
import type { ConsolidationRow, NewConsolidation } from '../types.js';
import type { IConsolidationRepository } from '../interfaces.js';

export class SqlServerConsolidationRepository implements IConsolidationRepository {
  constructor(private readonly pool: sql.ConnectionPool) {}

  /**
   * Inserts a new consolidation row. Generates createdAt timestamp automatically.
   * Uses OUTPUT INSERTED.* to return the inserted row in a single round-trip.
   */
  async insert(consolidation: NewConsolidation): Promise<ConsolidationRow> {
    const createdAt = new Date().toISOString();

    const result = await this.pool
      .request()
      .input('userId', sql.NVarChar, consolidation.userId)
      .input('sourceIds', sql.NVarChar, consolidation.sourceIds)
      .input('summary', sql.NVarChar, consolidation.summary)
      .input('insight', sql.NVarChar, consolidation.insight)
      .input('createdAt', sql.NVarChar, createdAt)
      .query(`
        INSERT INTO Consolidation (userId, sourceIds, summary, insight, createdAt)
        OUTPUT INSERTED.*
        VALUES (@userId, @sourceIds, @summary, @insight, @createdAt)
      `);

    return result.recordset[0] as ConsolidationRow;
  }

  /**
   * Returns all consolidation rows ordered by id ascending.
   */
  async getAll(): Promise<ConsolidationRow[]> {
    const result = await this.pool
      .request()
      .query('SELECT * FROM Consolidation ORDER BY id ASC');

    return result.recordset as ConsolidationRow[];
  }

  /**
   * Deletes all consolidation rows. Returns the number of rows deleted.
   */
  async deleteAll(): Promise<number> {
    const result = await this.pool
      .request()
      .query('DELETE FROM Consolidation');

    const affected = result.rowsAffected[0];
    return affected !== undefined ? affected : 0;
  }

  /**
   * Returns the total number of consolidation rows.
   */
  async getCount(): Promise<number> {
    const result = await this.pool
      .request()
      .query('SELECT COUNT(*) AS count FROM Consolidation');

    return (result.recordset[0] as { count: number }).count;
  }
}
