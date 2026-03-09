/**
 * SQL DDL statements for the Always-On Memory Agent database schema.
 * All tables use singular naming. Column names use camelCase.
 */

export const CREATE_MEMORY_TABLE = `
CREATE TABLE IF NOT EXISTS Memory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL DEFAULT 'default',
    source          TEXT    NOT NULL,
    rawText         TEXT    NOT NULL,
    summary         TEXT    NOT NULL,
    entities        TEXT    NOT NULL DEFAULT '[]',
    topics          TEXT    NOT NULL DEFAULT '[]',
    importance      REAL    NOT NULL DEFAULT 0.0,
    consolidated    INTEGER NOT NULL DEFAULT 0,
    connections     TEXT    NOT NULL DEFAULT '[]',
    createdAt       TEXT    NOT NULL
);`;

export const CREATE_CONSOLIDATION_TABLE = `
CREATE TABLE IF NOT EXISTS Consolidation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          TEXT    NOT NULL,
    sourceIds       TEXT    NOT NULL DEFAULT '[]',
    summary         TEXT    NOT NULL,
    insight         TEXT    NOT NULL,
    createdAt       TEXT    NOT NULL
);`;

export const CREATE_PROCESSED_FILE_TABLE = `
CREATE TABLE IF NOT EXISTS ProcessedFile (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filePath        TEXT    NOT NULL UNIQUE,
    processedAt     TEXT    NOT NULL
);`;

export const CREATE_MEMORY_USER_ID_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memory_userId ON Memory(userId);`;

export const CREATE_MEMORY_CONSOLIDATED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memory_consolidated ON Memory(consolidated);`;

export const CREATE_MEMORY_IMPORTANCE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_memory_importance ON Memory(importance);`;

export const CREATE_CONSOLIDATION_USER_ID_INDEX = `
CREATE INDEX IF NOT EXISTS idx_consolidation_userId ON Consolidation(userId);`;

export const ALL_SCHEMA_STATEMENTS: readonly string[] = [
  CREATE_MEMORY_TABLE,
  CREATE_CONSOLIDATION_TABLE,
  CREATE_PROCESSED_FILE_TABLE,
  CREATE_MEMORY_USER_ID_INDEX,
  CREATE_MEMORY_CONSOLIDATED_INDEX,
  CREATE_MEMORY_IMPORTANCE_INDEX,
  CREATE_CONSOLIDATION_USER_ID_INDEX,
];
