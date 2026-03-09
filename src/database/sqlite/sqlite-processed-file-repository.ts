/**
 * SQLite implementation of the IProcessedFileRepository interface.
 * All methods are async (returning Promises) to conform to the interface,
 * though the underlying better-sqlite3 operations are synchronous.
 */

import type Database from 'better-sqlite3';
import type { ProcessedFileRow } from '../types.js';
import type { IProcessedFileRepository } from '../interfaces.js';

export class SqliteProcessedFileRepository implements IProcessedFileRepository {
  private readonly isProcessedStmt: Database.Statement;
  private readonly markProcessedStmt: Database.Statement;
  private readonly getAllStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.isProcessedStmt = db.prepare('SELECT 1 FROM ProcessedFile WHERE filePath = ?');

    this.markProcessedStmt = db.prepare(`
      INSERT OR IGNORE INTO ProcessedFile (filePath, processedAt)
      VALUES (?, ?)
    `);

    this.getAllStmt = db.prepare('SELECT * FROM ProcessedFile ORDER BY id ASC');
  }

  /**
   * Checks whether a file has already been processed.
   */
  async isProcessed(filePath: string): Promise<boolean> {
    return this.isProcessedStmt.get(filePath) !== undefined;
  }

  /**
   * Marks a file as processed with the current timestamp.
   */
  async markProcessed(filePath: string): Promise<void> {
    this.markProcessedStmt.run(filePath, new Date().toISOString());
  }

  /**
   * Returns all processed file rows ordered by id ascending.
   */
  async getAll(): Promise<ProcessedFileRow[]> {
    return this.getAllStmt.all() as ProcessedFileRow[];
  }
}
