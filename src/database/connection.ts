/**
 * Database connection management for the Always-On Memory Agent.
 * Uses better-sqlite3 with WAL mode for concurrent read performance.
 */

import Database from 'better-sqlite3';
import { ALL_SCHEMA_STATEMENTS } from './schema.js';

/**
 * Opens a SQLite database connection, enables WAL mode,
 * and executes all CREATE TABLE/INDEX statements.
 *
 * @param dbPath - Absolute or relative path to the SQLite database file.
 * @returns The initialized database instance.
 */
export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable Write-Ahead Logging for better concurrent read performance
  db.pragma('journal_mode = WAL');

  // Execute all schema creation statements
  for (const statement of ALL_SCHEMA_STATEMENTS) {
    db.exec(statement);
  }

  return db;
}

/**
 * Closes the database connection gracefully.
 *
 * @param db - The database instance to close.
 */
export function closeDatabase(db: Database.Database): void {
  db.close();
}
