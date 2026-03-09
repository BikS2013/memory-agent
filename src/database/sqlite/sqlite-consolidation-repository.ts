/**
 * SQLite implementation of the IConsolidationRepository interface.
 * All methods are async (returning Promises) to conform to the interface,
 * though the underlying better-sqlite3 operations are synchronous.
 */

import type Database from 'better-sqlite3';
import type { ConsolidationRow, NewConsolidation } from '../types.js';
import type { IConsolidationRepository } from '../interfaces.js';

export class SqliteConsolidationRepository implements IConsolidationRepository {
  private readonly db: Database.Database;

  private readonly insertStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;
  private readonly deleteAllStmt: Database.Statement;
  private readonly getCountStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(`
      INSERT INTO Consolidation (userId, sourceIds, summary, insight, createdAt)
      VALUES (@userId, @sourceIds, @summary, @insight, @createdAt)
    `);

    this.getAllStmt = db.prepare('SELECT * FROM Consolidation ORDER BY id ASC');

    this.deleteAllStmt = db.prepare('DELETE FROM Consolidation');

    this.getCountStmt = db.prepare('SELECT COUNT(*) AS count FROM Consolidation');
  }

  /**
   * Inserts a new consolidation row. Generates createdAt timestamp automatically.
   */
  async insert(consolidation: NewConsolidation): Promise<ConsolidationRow> {
    const params = {
      userId: consolidation.userId,
      sourceIds: consolidation.sourceIds,
      summary: consolidation.summary,
      insight: consolidation.insight,
      createdAt: new Date().toISOString(),
    };

    const result = this.insertStmt.run(params);
    const id = Number(result.lastInsertRowid);

    return this.db.prepare('SELECT * FROM Consolidation WHERE id = ?').get(id) as ConsolidationRow;
  }

  /**
   * Returns all consolidation rows ordered by id ascending.
   */
  async getAll(): Promise<ConsolidationRow[]> {
    return this.getAllStmt.all() as ConsolidationRow[];
  }

  /**
   * Deletes all consolidation rows. Returns the number of rows deleted.
   */
  async deleteAll(): Promise<number> {
    const result = this.deleteAllStmt.run();
    return result.changes;
  }

  /**
   * Returns the total number of consolidation rows.
   */
  async getCount(): Promise<number> {
    return (this.getCountStmt.get() as { count: number }).count;
  }
}
