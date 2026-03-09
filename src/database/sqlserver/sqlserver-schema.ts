/**
 * SQL Server DDL statements and schema initialization for the Always-On Memory Agent.
 * Uses IF OBJECT_ID(...) IS NULL pattern for idempotent table creation.
 */

import sql from 'mssql';

/**
 * DDL for the Memory table with indexes.
 */
export const CREATE_MEMORY_TABLE_DDL = `
IF OBJECT_ID('dbo.Memory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Memory (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    userId              NVARCHAR(255)   NOT NULL DEFAULT 'default',
    source              NVARCHAR(MAX)   NOT NULL,
    rawText             NVARCHAR(MAX)   NOT NULL,
    summary             NVARCHAR(MAX)   NOT NULL,
    entities            NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    topics              NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    importance          FLOAT           NOT NULL DEFAULT 0.0,
    consolidated        BIT             NOT NULL DEFAULT 0,
    connections         NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    createdAt           NVARCHAR(50)    NOT NULL,
    CONSTRAINT CK_Memory_importance CHECK (importance >= 0.0 AND importance <= 1.0)
  );

  CREATE INDEX idx_memory_userId ON dbo.Memory(userId);
  CREATE INDEX idx_memory_consolidated ON dbo.Memory(consolidated);
  CREATE INDEX idx_memory_importance ON dbo.Memory(importance);
END
`;

/**
 * DDL for the Consolidation table with indexes.
 */
export const CREATE_CONSOLIDATION_TABLE_DDL = `
IF OBJECT_ID('dbo.Consolidation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Consolidation (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    userId              NVARCHAR(255)   NOT NULL,
    sourceIds           NVARCHAR(MAX)   NOT NULL DEFAULT '[]',
    summary             NVARCHAR(MAX)   NOT NULL,
    insight             NVARCHAR(MAX)   NOT NULL,
    createdAt           NVARCHAR(50)    NOT NULL
  );

  CREATE INDEX idx_consolidation_userId ON dbo.Consolidation(userId);
END
`;

/**
 * DDL for the ProcessedFile table with unique constraint on filePath.
 */
export const CREATE_PROCESSED_FILE_TABLE_DDL = `
IF OBJECT_ID('dbo.ProcessedFile', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProcessedFile (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    filePath            NVARCHAR(1000)  NOT NULL,
    processedAt         NVARCHAR(50)    NOT NULL,
    CONSTRAINT UQ_ProcessedFile_filePath UNIQUE (filePath)
  );
END
`;

/**
 * Initializes the SQL Server schema by executing all DDL statements.
 * Idempotent: safe to call multiple times (tables are only created if they don't exist).
 *
 * @param pool - An open SQL Server connection pool.
 */
export async function initializeSqlServerSchema(pool: sql.ConnectionPool): Promise<void> {
  const request = pool.request();
  await request.batch(CREATE_MEMORY_TABLE_DDL);
  await request.batch(CREATE_CONSOLIDATION_TABLE_DDL);
  await request.batch(CREATE_PROCESSED_FILE_TABLE_DDL);
}
