/**
 * SQL Server implementation of the IMemoryRepository interface.
 * Uses parameterized queries via mssql connection pool for all operations.
 */

import sql from 'mssql';
import type { MemoryRow, NewMemory, ConnectionEntry, MemoryStats } from '../types.js';
import type { IMemoryRepository } from '../interfaces.js';

export class SqlServerMemoryRepository implements IMemoryRepository {
  constructor(private readonly pool: sql.ConnectionPool) {}

  /**
   * Inserts a new memory row. Generates createdAt timestamp and applies defaults.
   * userId defaults to 'default' if not provided.
   * Uses OUTPUT INSERTED.* to return the inserted row in a single round-trip.
   */
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

  /**
   * Returns all memory rows ordered by createdAt descending.
   */
  async getAll(): Promise<MemoryRow[]> {
    const result = await this.pool
      .request()
      .query('SELECT * FROM Memory ORDER BY id ASC');

    return result.recordset.map((row) => this.mapRow(row));
  }

  /**
   * Returns a single memory row by id, or undefined if not found.
   */
  async getById(id: number): Promise<MemoryRow | undefined> {
    const result = await this.pool
      .request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM Memory WHERE id = @id');

    if (result.recordset.length === 0) {
      return undefined;
    }
    return this.mapRow(result.recordset[0]);
  }

  /**
   * Returns all memory rows that have not been consolidated (consolidated = 0).
   */
  async getUnconsolidated(): Promise<MemoryRow[]> {
    const result = await this.pool
      .request()
      .query('SELECT * FROM Memory WHERE consolidated = 0 ORDER BY id ASC');

    return result.recordset.map((row) => this.mapRow(row));
  }

  /**
   * Marks the specified memory ids as consolidated (consolidated = 1).
   * Uses a transaction for atomicity: either all ids are marked or none.
   */
  async markConsolidated(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

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

  /**
   * Updates the connections JSON field for a specific memory.
   */
  async updateConnections(id: number, connections: ConnectionEntry[]): Promise<void> {
    await this.pool
      .request()
      .input('id', sql.Int, id)
      .input('connections', sql.NVarChar, JSON.stringify(connections))
      .query('UPDATE Memory SET connections = @connections WHERE id = @id');
  }

  /**
   * Deletes a memory row by id. Returns true if a row was deleted, false otherwise.
   */
  async deleteById(id: number): Promise<boolean> {
    const result = await this.pool
      .request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Memory WHERE id = @id');

    const affected = result.rowsAffected[0];
    return (affected !== undefined ? affected : 0) > 0;
  }

  /**
   * Deletes all memory rows. Returns the number of rows deleted.
   */
  async deleteAll(): Promise<number> {
    const result = await this.pool
      .request()
      .query('DELETE FROM Memory');

    const affected = result.rowsAffected[0];
    return affected !== undefined ? affected : 0;
  }

  /**
   * Returns aggregate statistics about stored memories.
   * Queries both Memory and Consolidation tables in a single statement.
   */
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
