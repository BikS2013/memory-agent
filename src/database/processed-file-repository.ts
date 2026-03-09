/**
 * Repository for ProcessedFile table operations.
 * Tracks which files have been ingested to prevent duplicate processing.
 * All methods use prepared statements for performance and SQL injection protection.
 */

import type Database from 'better-sqlite3';
import type { ProcessedFileRow } from './types.js';

export class ProcessedFileRepository {
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
  isProcessed(filePath: string): boolean {
    return this.isProcessedStmt.get(filePath) !== undefined;
  }

  /**
   * Marks a file as processed with the current timestamp.
   */
  markProcessed(filePath: string): void {
    this.markProcessedStmt.run(filePath, new Date().toISOString());
  }

  /**
   * Returns all processed file rows ordered by id ascending.
   */
  getAll(): ProcessedFileRow[] {
    return this.getAllStmt.all() as ProcessedFileRow[];
  }
}
