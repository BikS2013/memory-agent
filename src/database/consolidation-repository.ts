/**
 * Repository for Consolidation table CRUD operations.
 * All methods use prepared statements for performance and SQL injection protection.
 */

import type Database from 'better-sqlite3';
import type { ConsolidationRow, NewConsolidation } from './types.js';

export class ConsolidationRepository {
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
  insert(consolidation: NewConsolidation): ConsolidationRow {
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
  getAll(): ConsolidationRow[] {
    return this.getAllStmt.all() as ConsolidationRow[];
  }

  /**
   * Deletes all consolidation rows. Returns the number of rows deleted.
   */
  deleteAll(): number {
    const result = this.deleteAllStmt.run();
    return result.changes;
  }

  /**
   * Returns the total number of consolidation rows.
   */
  getCount(): number {
    return (this.getCountStmt.get() as { count: number }).count;
  }
}
