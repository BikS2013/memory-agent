/**
 * Repository for Memory table CRUD operations.
 * All methods use prepared statements for performance and SQL injection protection.
 */

import type Database from 'better-sqlite3';
import type { MemoryRow, NewMemory, ConnectionEntry, MemoryStats } from './types.js';

export class MemoryRepository {
  private readonly db: Database.Database;

  private readonly insertStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly getUnconsolidatedStmt: Database.Statement;
  private readonly updateConnectionsStmt: Database.Statement;
  private readonly deleteByIdStmt: Database.Statement;
  private readonly deleteAllStmt: Database.Statement;
  private readonly totalCountStmt: Database.Statement;
  private readonly consolidatedCountStmt: Database.Statement;
  private readonly consolidationsCountStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.insertStmt = db.prepare(`
      INSERT INTO Memory (userId, source, rawText, summary, entities, topics, importance, consolidated, connections, createdAt)
      VALUES (@userId, @source, @rawText, @summary, @entities, @topics, @importance, 0, '[]', @createdAt)
    `);

    this.getAllStmt = db.prepare('SELECT * FROM Memory ORDER BY id ASC');

    this.getByIdStmt = db.prepare('SELECT * FROM Memory WHERE id = ?');

    this.getUnconsolidatedStmt = db.prepare('SELECT * FROM Memory WHERE consolidated = 0 ORDER BY id ASC');

    this.updateConnectionsStmt = db.prepare('UPDATE Memory SET connections = ? WHERE id = ?');

    this.deleteByIdStmt = db.prepare('DELETE FROM Memory WHERE id = ?');

    this.deleteAllStmt = db.prepare('DELETE FROM Memory');

    this.totalCountStmt = db.prepare('SELECT COUNT(*) AS count FROM Memory');

    this.consolidatedCountStmt = db.prepare('SELECT COUNT(*) AS count FROM Memory WHERE consolidated = 1');

    this.consolidationsCountStmt = db.prepare('SELECT COUNT(*) AS count FROM Consolidation');
  }

  /**
   * Inserts a new memory row. Generates createdAt timestamp and applies defaults.
   * userId defaults to 'default' if not provided.
   */
  insert(memory: NewMemory): MemoryRow {
    const params = {
      userId: memory.userId ?? 'default',
      source: memory.source,
      rawText: memory.rawText,
      summary: memory.summary,
      entities: memory.entities,
      topics: memory.topics,
      importance: memory.importance,
      createdAt: new Date().toISOString(),
    };

    const result = this.insertStmt.run(params);
    return this.getById(Number(result.lastInsertRowid))!;
  }

  /**
   * Returns all memory rows ordered by id ascending.
   */
  getAll(): MemoryRow[] {
    return this.getAllStmt.all() as MemoryRow[];
  }

  /**
   * Returns a single memory row by id, or undefined if not found.
   */
  getById(id: number): MemoryRow | undefined {
    return this.getByIdStmt.get(id) as MemoryRow | undefined;
  }

  /**
   * Returns all memory rows that have not been consolidated (consolidated = 0).
   */
  getUnconsolidated(): MemoryRow[] {
    return this.getUnconsolidatedStmt.all() as MemoryRow[];
  }

  /**
   * Marks the specified memory ids as consolidated (consolidated = 1).
   * Uses a transaction for atomicity.
   */
  markConsolidated(ids: number[]): void {
    const markStmt = this.db.prepare('UPDATE Memory SET consolidated = 1 WHERE id = ?');
    const transaction = this.db.transaction((memoryIds: number[]) => {
      for (const id of memoryIds) {
        markStmt.run(id);
      }
    });
    transaction(ids);
  }

  /**
   * Updates the connections JSON field for a specific memory.
   */
  updateConnections(id: number, connections: ConnectionEntry[]): void {
    this.updateConnectionsStmt.run(JSON.stringify(connections), id);
  }

  /**
   * Deletes a memory row by id. Returns true if a row was deleted, false otherwise.
   */
  deleteById(id: number): boolean {
    const result = this.deleteByIdStmt.run(id);
    return result.changes > 0;
  }

  /**
   * Deletes all memory rows. Returns the number of rows deleted.
   */
  deleteAll(): number {
    const result = this.deleteAllStmt.run();
    return result.changes;
  }

  /**
   * Returns aggregate statistics about stored memories.
   */
  getStats(): MemoryStats {
    const total = (this.totalCountStmt.get() as { count: number }).count;
    const consolidated = (this.consolidatedCountStmt.get() as { count: number }).count;
    const consolidations = (this.consolidationsCountStmt.get() as { count: number }).count;

    return {
      total,
      consolidated,
      unconsolidated: total - consolidated,
      consolidations,
    };
  }
}
