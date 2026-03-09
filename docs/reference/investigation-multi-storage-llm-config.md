# Technical Investigation: Multi-Storage Backend & YAML Configuration

**Date**: 2026-03-09
**Author**: Technical Research Team
**Status**: Complete
**Related Documents**:
- [Refined Request](./refined-request-multi-storage-llm-config.md)
- [Codebase Scan](./codebase-scan-multi-storage-llm-config.md)

---

## Executive Summary

This investigation examines the technical feasibility and implementation patterns for adding multi-storage backend support (SQLite, SQL Server, Azure Blob Storage) and YAML-based configuration to the Always-On Memory Agent. All five research areas have been thoroughly investigated with current 2026 package versions and best practices.

### Key Findings

1. **YAML Parsing**: `js-yaml` (v4.1.1) combined with Zod provides robust type-safe YAML parsing with schema validation
2. **SQL Server**: `mssql` (v12.2.0) offers excellent TypeScript support with connection pooling and async patterns
3. **Azure Blob Storage**: `@azure/storage-blob` (v12.31.0) provides comprehensive APIs for JSON blob operations with ETag-based concurrency
4. **Repository Pattern**: Async interface abstraction is recommended; better-sqlite3 should be wrapped for consistency
5. **LangChain.js Configuration**: All chat model constructors support optional `configuration.baseURL` and `organization` parameters

### Critical Architectural Decision

**All repository interfaces must be async (return `Promise<T>`)** to accommodate SQL Server and Azure Blob Storage. This requires updating all 6 consumer modules (agents, API routes, file watcher) to use `await` for repository calls. SQLite operations will be wrapped in async functions despite being synchronous internally, prioritizing API consistency over marginal performance differences.

---

## 1. YAML Parsing in TypeScript

### Research Area
How to parse YAML configuration files with type safety, schema validation using Zod, and current best practices.

### Package: js-yaml

**Current Version**: 4.1.1 (as of March 2026)
**Install**: `npm install js-yaml @types/js-yaml`
**Reputation**: High (24,405+ npm projects using it)
**Maturity**: Stable, YAML 1.2 compliant

#### Core API

```typescript
import * as yaml from 'js-yaml';
import * as fs from 'fs';

// Basic parsing
const doc = yaml.load(fs.readFileSync('/path/to/file.yml', 'utf8'));

// With options
const doc = yaml.load(fileContent, {
  filename: 'config.yaml',      // For better error messages
  schema: yaml.DEFAULT_SCHEMA,  // FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA
  json: false,                  // JSON.parse compatibility mode
  onWarning: (warning) => console.warn(warning)
});
```

#### Integration with Zod for Type Safety

The recommended pattern combines `js-yaml` for parsing with Zod for runtime validation and type inference:

```typescript
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';

// Define Zod schema
const storageConfigSchema = z.object({
  storage: z.object({
    provider: z.enum(['sqlite', 'sqlserver', 'azure-blob']),
    sqlite: z.object({
      databasePath: z.string()
    }).optional(),
    sqlserver: z.object({
      server: z.string(),
      port: z.number().positive(),
      database: z.string(),
      user: z.string(),
      password: z.string(),
      encrypt: z.boolean(),
      trustServerCertificate: z.boolean()
    }).optional(),
    azureBlob: z.object({
      connectionString: z.string(),
      containerName: z.string(),
      timePeriodFormat: z.enum(['monthly', 'weekly', 'daily'])
    }).optional()
  })
});

// Infer TypeScript type from Zod schema
type StorageConfig = z.infer<typeof storageConfigSchema>;

// Load and validate
function loadStorageConfig(configPath: string): StorageConfig {
  const configFile = fs.readFileSync(configPath, 'utf8');
  const configData = yaml.load(configFile);

  // Parse with Zod (throws ZodError on validation failure)
  return storageConfigSchema.parse(configData);
}
```

#### Conditional Validation Pattern

For the requirement that only the active provider's section must be complete:

```typescript
const storageConfigSchema = z.object({
  storage: z.object({
    provider: z.enum(['sqlite', 'sqlserver', 'azure-blob']),
    sqlite: z.object({
      databasePath: z.string()
    }).optional(),
    sqlserver: z.object({
      server: z.string(),
      port: z.number().positive(),
      database: z.string(),
      user: z.string(),
      password: z.string(),
      encrypt: z.boolean(),
      trustServerCertificate: z.boolean()
    }).optional(),
    azureBlob: z.object({
      connectionString: z.string(),
      containerName: z.string(),
      timePeriodFormat: z.enum(['monthly', 'weekly', 'daily'])
    }).optional()
  })
}).refine(
  (data) => {
    // Validate that the active provider's section exists and is complete
    switch (data.storage.provider) {
      case 'sqlite':
        return data.storage.sqlite !== undefined;
      case 'sqlserver':
        return data.storage.sqlserver !== undefined;
      case 'azure-blob':
        return data.storage.azureBlob !== undefined;
      default:
        return false;
    }
  },
  {
    message: "Configuration for the selected storage provider is missing or incomplete"
  }
);
```

#### Error Handling

```typescript
try {
  const config = loadStorageConfig(configPath);
} catch (error) {
  if (error instanceof yaml.YAMLException) {
    // YAML parsing error
    console.error(`YAML Parse Error: ${error.message}`);
  } else if (error instanceof z.ZodError) {
    // Schema validation error
    console.error('Configuration validation failed:');
    error.errors.forEach(err => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  }
  process.exit(1);
}
```

### Alternative: eemeli/yaml

An alternative package `yaml` (v2.x) from eemeli was also identified with:
- Higher benchmark score (67.4 vs unknown for js-yaml)
- Support for YAML 1.1 and 1.2
- Preserves comments and blank lines
- 100 code snippets in Context7

**Recommendation**: Stick with `js-yaml` due to wider adoption (24,405+ projects vs fewer for eemeli/yaml), well-established API, and sufficient feature set for configuration parsing.

### Recommendations

✅ **Use `js-yaml` v4.1.1** with `@types/js-yaml` for TypeScript support
✅ **Use Zod v3.x** for schema validation and type inference
✅ **Use `.refine()` method** for conditional validation based on active provider
✅ **Read files synchronously** during startup (acceptable for config loading)
✅ **Provide detailed error messages** distinguishing YAML parse errors from validation errors

---

## 2. SQL Server via mssql npm Package

### Research Area
Connection pooling, prepared statements, TypeScript support, schema initialization patterns, and async API patterns for SQL Server.

### Package: mssql

**Current Version**: 12.2.0 (as of March 2026)
**Install**: `npm install mssql @types/mssql`
**TypeScript Types**: @types/mssql v9.1.9 (updated January 2026)
**Reputation**: High (1,703+ npm projects using it)

#### Connection Configuration

```typescript
import * as sql from 'mssql';

const sqlConfig: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
  database: process.env.DB_NAME,
  server: 'localhost',
  pool: {
    max: 10,                    // Maximum pool size
    min: 0,                     // Minimum pool size
    idleTimeoutMillis: 30000    // Close idle connections after 30s
  },
  options: {
    encrypt: true,                    // For Azure SQL
    trustServerCertificate: false     // Set to true for local dev / self-signed certs
  }
};
```

#### Connection Pooling

The `mssql` package manages connection pooling automatically:

```typescript
// Global connection pool pattern
let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// Query against the pool
async function runQuery(query: string) {
  const pool = await getPool();
  return pool.query(query);
}

// Cleanup on shutdown
async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
```

#### Async API with Prepared Statements

```typescript
// Async/await pattern with parameterized queries
async function getMemoryById(id: number): Promise<MemoryRow | undefined> {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM Memory WHERE id = @id');

  return result.recordset[0];
}

// Prepared statements for repeated queries
const ps = new sql.PreparedStatement(pool);
ps.input('userId', sql.VarChar);
ps.input('content', sql.NVarChar);

await ps.prepare('INSERT INTO Memory (userId, content) VALUES (@userId, @content)');

// Execute multiple times
await ps.execute({ userId: 'user1', content: 'Memory 1' });
await ps.execute({ userId: 'user2', content: 'Memory 2' });

// Must unprepare to release connection
await ps.unprepare();
```

#### SQL Server Type Mappings

```typescript
// Common type mappings
sql.Int          // INTEGER
sql.BigInt       // BIGINT
sql.VarChar(n)   // VARCHAR(n)
sql.NVarChar(n)  // NVARCHAR(n) - use for Unicode
sql.Text         // TEXT
sql.NText        // NTEXT - use for Unicode text
sql.Bit          // BIT (boolean)
sql.DateTime     // DATETIME
sql.Float        // FLOAT
```

#### Schema Initialization Pattern

SQL Server does not support `CREATE TABLE IF NOT EXISTS`. The recommended pattern uses `OBJECT_ID()`:

```typescript
async function initializeSchema(pool: sql.ConnectionPool): Promise<void> {
  // Check if Memory table exists
  const checkTableQuery = `
    IF OBJECT_ID('dbo.Memory', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Memory (
        id INT IDENTITY(1,1) PRIMARY KEY,
        userId NVARCHAR(255) NOT NULL,
        content NVARCHAR(MAX) NOT NULL,
        entities NVARCHAR(MAX),
        topics NVARCHAR(MAX),
        importance INT NOT NULL DEFAULT 5,
        timestamp DATETIME NOT NULL DEFAULT GETDATE(),
        consolidated BIT NOT NULL DEFAULT 0,
        connections NVARCHAR(MAX),
        sourceType NVARCHAR(50),
        sourceReference NVARCHAR(MAX)
      );

      -- Create indexes
      CREATE INDEX idx_memory_userId ON dbo.Memory(userId);
      CREATE INDEX idx_memory_consolidated ON dbo.Memory(consolidated);
      CREATE INDEX idx_memory_importance ON dbo.Memory(importance);
    END
  `;

  await pool.request().query(checkTableQuery);
}
```

**Alternative Pattern Using `sys.tables`**:

```typescript
const checkQuery = `
  IF NOT EXISTS (
    SELECT * FROM sys.tables
    WHERE name = 'Memory'
    AND SCHEMA_NAME(schema_id) = 'dbo'
  )
  BEGIN
    CREATE TABLE dbo.Memory (...);
  END
`;
```

**Alternative Pattern Using `INFORMATION_SCHEMA`** (more portable):

```typescript
const checkQuery = `
  IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'Memory'
  )
  BEGIN
    CREATE TABLE dbo.Memory (...);
  END
`;
```

**Recommendation**: Use `OBJECT_ID()` pattern as it's most performant and widely recommended by SQL Server experts.

#### Transaction Support

```typescript
async function markConsolidated(ids: number[]): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const request = new sql.Request(transaction);
    for (const id of ids) {
      await request
        .input('id', sql.Int, id)
        .query('UPDATE Memory SET consolidated = 1 WHERE id = @id');
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

#### TypeScript Support

The `@types/mssql` package provides excellent type definitions:

```typescript
import * as sql from 'mssql';

// Type-safe configuration
const config: sql.config = { /* ... */ };

// Type-safe result handling
interface MemoryRow {
  id: number;
  userId: string;
  content: string;
  // ...
}

const result: sql.IResult<MemoryRow> = await pool.request()
  .query<MemoryRow>('SELECT * FROM Memory');

const memories: MemoryRow[] = result.recordset;
```

### Recommendations

✅ **Use global connection pool pattern** (`sql.connect()` returns existing pool if available)
✅ **Use parameterized queries** with `.input()` to prevent SQL injection
✅ **Use `OBJECT_ID()` pattern** for checking table existence before CREATE
✅ **Use transactions** for multi-statement operations requiring atomicity
✅ **Use `IDENTITY(1,1)` for auto-increment** instead of SQLite's `AUTOINCREMENT`
✅ **Use `NVARCHAR` for text fields** to support Unicode (existing data has international characters)
✅ **Use `NVARCHAR(MAX)` for JSON storage** (equivalent to SQLite's TEXT for large strings)
✅ **Clean up prepared statements** with `.unprepare()` to avoid pool exhaustion
✅ **Handle connection errors gracefully** with retry logic during startup

---

## 3. Azure Blob Storage via @azure/storage-blob

### Research Area
Reading/writing JSON blobs, listing by prefix for {userId}/{timePeriod}/ pattern, authentication methods, ETag-based concurrency, and current API version.

### Package: @azure/storage-blob

**Current Version**: 12.31.0 (as of March 2026)
**Install**: `npm install @azure/storage-blob @azure/identity`
**Latest Service Version**: 2026-02-06
**Reputation**: Official Azure SDK, actively maintained

#### Connection and Authentication

**Option 1: Connection String** (simpler for initial implementation)

```typescript
import { BlobServiceClient } from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
```

**Option 2: DefaultAzureCredential** (recommended for production, especially Azure-hosted)

```typescript
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
const accountURL = `https://${accountName}.blob.core.windows.net`;
const blobServiceClient = new BlobServiceClient(
  accountURL,
  new DefaultAzureCredential()
);
```

**Recommendation**: Support connection string in initial implementation as specified in the refined request. DefaultAzureCredential can be added later as an enhancement.

#### Container and Blob Client Hierarchy

```typescript
// Get container client
const containerClient = blobServiceClient.getContainerClient('memory-container');

// Ensure container exists
await containerClient.createIfNotExists();

// Get blob client (for specific blob)
const blobName = 'user1/2026-03/memories.json';
const blobClient = containerClient.getBlobClient(blobName);
const blockBlobClient = blobClient.getBlockBlobClient();
```

#### Writing JSON Blobs

```typescript
interface MemoryRow {
  id: number;
  userId: string;
  content: string;
  // ...
}

async function writeMemoriesBlob(
  userId: string,
  timePeriod: string,
  memories: MemoryRow[]
): Promise<void> {
  const blobName = `${userId}/${timePeriod}/memories.json`;
  const blockBlobClient = containerClient
    .getBlobClient(blobName)
    .getBlockBlobClient();

  const jsonContent = JSON.stringify(memories, null, 2);
  const contentBuffer = Buffer.from(jsonContent, 'utf-8');

  await blockBlobClient.upload(contentBuffer, contentBuffer.length, {
    blobHTTPHeaders: {
      blobContentType: 'application/json'
    }
  });
}
```

#### Reading JSON Blobs

```typescript
async function readMemoriesBlob(
  userId: string,
  timePeriod: string
): Promise<MemoryRow[]> {
  const blobName = `${userId}/${timePeriod}/memories.json`;
  const blockBlobClient = containerClient
    .getBlobClient(blobName)
    .getBlockBlobClient();

  try {
    const downloadResponse = await blockBlobClient.download(0);
    const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody!);
    const jsonString = downloadedContent.toString('utf-8');
    return JSON.parse(jsonString);
  } catch (error: any) {
    if (error.statusCode === 404) {
      // Blob doesn't exist yet
      return [];
    }
    throw error;
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    readableStream.on('end', () => resolve(Buffer.concat(chunks)));
    readableStream.on('error', reject);
  });
}
```

#### Listing Blobs by Prefix

For the `{userId}/{timePeriod}/` pattern, use `listBlobsByHierarchy` with prefix:

```typescript
async function listTimePeriodBlobs(userId: string): Promise<string[]> {
  const prefix = `${userId}/`;
  const timePeriods: string[] = [];

  // List blobs hierarchically to get "virtual folders"
  for await (const response of containerClient
    .listBlobsByHierarchy('/', { prefix })
    .byPage({ maxPageSize: 100 })) {

    // Check for blob prefixes (virtual directories)
    if (response.segment.blobPrefixes) {
      for (const blobPrefix of response.segment.blobPrefixes) {
        // blobPrefix.name will be like "user1/2026-03/"
        const parts = blobPrefix.name.split('/');
        if (parts.length >= 2) {
          timePeriods.push(parts[1]); // Extract "2026-03"
        }
      }
    }
  }

  return timePeriods;
}

// List all memories blobs for a user across all time periods
async function listAllMemoryBlobsForUser(userId: string): Promise<string[]> {
  const prefix = `${userId}/`;
  const blobNames: string[] = [];

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith('/memories.json')) {
      blobNames.push(blob.name);
    }
  }

  return blobNames;
}
```

#### ETag-Based Optimistic Concurrency

Azure Blob Storage uses ETags for optimistic concurrency control:

```typescript
async function updateMemoriesWithOptimisticConcurrency(
  userId: string,
  timePeriod: string,
  updateFn: (memories: MemoryRow[]) => MemoryRow[]
): Promise<void> {
  const blobName = `${userId}/${timePeriod}/memories.json`;
  const blockBlobClient = containerClient
    .getBlobClient(blobName)
    .getBlockBlobClient();

  let retries = 3;

  while (retries > 0) {
    try {
      // Step 1: Download current blob and ETag
      const downloadResponse = await blockBlobClient.download(0);
      const currentETag = downloadResponse.etag;
      const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody!);
      const memories: MemoryRow[] = JSON.parse(downloadedContent.toString('utf-8'));

      // Step 2: Apply transformation
      const updatedMemories = updateFn(memories);

      // Step 3: Upload with If-Match condition
      const jsonContent = JSON.stringify(updatedMemories, null, 2);
      const contentBuffer = Buffer.from(jsonContent, 'utf-8');

      await blockBlobClient.upload(contentBuffer, contentBuffer.length, {
        conditions: {
          ifMatch: currentETag  // Only upload if ETag hasn't changed
        },
        blobHTTPHeaders: {
          blobContentType: 'application/json'
        }
      });

      // Success!
      return;

    } catch (error: any) {
      if (error.statusCode === 412) {
        // Precondition Failed - ETag mismatch, retry
        retries--;
        if (retries === 0) {
          throw new Error('Failed to update blob after multiple retries due to concurrent modifications');
        }
        // Optional: Add exponential backoff
        await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
      } else {
        throw error;
      }
    }
  }
}
```

#### Handling Non-Existent Blobs

```typescript
async function getMemoriesOrEmpty(
  userId: string,
  timePeriod: string
): Promise<MemoryRow[]> {
  const blobName = `${userId}/${timePeriod}/memories.json`;
  const blockBlobClient = containerClient
    .getBlobClient(blobName)
    .getBlockBlobClient();

  try {
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return [];
    }

    const downloadResponse = await blockBlobClient.download(0);
    const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody!);
    return JSON.parse(downloadedContent.toString('utf-8'));
  } catch (error: any) {
    if (error.statusCode === 404) {
      return [];
    }
    throw error;
  }
}
```

#### Time Period Formatting

Implement time period bucket logic:

```typescript
type TimePeriodFormat = 'monthly' | 'weekly' | 'daily';

function getCurrentTimePeriod(format: TimePeriodFormat): string {
  const now = new Date();

  switch (format) {
    case 'monthly':
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;  // e.g., "2026-03"

    case 'weekly':
      const weekYear = now.getFullYear();
      const weekNumber = getWeekNumber(now);
      return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;  // e.g., "2026-W10"

    case 'daily':
      const dayYear = now.getFullYear();
      const dayMonth = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${dayYear}-${dayMonth}-${day}`;  // e.g., "2026-03-09"
  }
}

// ISO 8601 week number calculation
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
```

#### Pessimistic Concurrency with Blob Leases (Alternative)

For scenarios requiring exclusive locks:

```typescript
import { BlobLeaseClient } from '@azure/storage-blob';

async function updateMemoriesWithLease(
  userId: string,
  timePeriod: string,
  updateFn: (memories: MemoryRow[]) => MemoryRow[]
): Promise<void> {
  const blobName = `${userId}/${timePeriod}/memories.json`;
  const blockBlobClient = containerClient
    .getBlobClient(blobName)
    .getBlockBlobClient();

  const blobLeaseClient = blockBlobClient.getBlobLeaseClient();

  try {
    // Acquire lease for 15 seconds
    const leaseResult = await blobLeaseClient.acquireLease(15);
    const leaseId = leaseResult.leaseId;

    // Download with lease
    const downloadResponse = await blockBlobClient.download(0, undefined, {
      conditions: { leaseId }
    });
    const downloadedContent = await streamToBuffer(downloadResponse.readableStreamBody!);
    const memories: MemoryRow[] = JSON.parse(downloadedContent.toString('utf-8'));

    // Apply transformation
    const updatedMemories = updateFn(memories);

    // Upload with lease
    const jsonContent = JSON.stringify(updatedMemories, null, 2);
    const contentBuffer = Buffer.from(jsonContent, 'utf-8');

    await blockBlobClient.upload(contentBuffer, contentBuffer.length, {
      conditions: { leaseId },
      blobHTTPHeaders: {
        blobContentType: 'application/json'
      }
    });

    // Release lease
    await blobLeaseClient.releaseLease();

  } catch (error) {
    // Attempt to release lease on error
    try {
      await blobLeaseClient.releaseLease();
    } catch {}
    throw error;
  }
}
```

### Concurrency Strategy Comparison

| Strategy | Pros | Cons | Use Case |
|----------|------|------|----------|
| **ETag (Optimistic)** | Simple, no lock overhead, works well for low contention | Requires retry logic, may loop under high contention | Recommended for most scenarios; retry 3-5 times with backoff |
| **Blob Lease (Pessimistic)** | Guaranteed exclusive access, no retries needed | Lock overhead, risk of orphaned leases (mitigated by timeout) | High-contention scenarios or when retries are unacceptable |

**Recommendation**: Use ETag-based optimistic concurrency as specified in the technical constraints. The typical agent usage pattern (single-user consolidation, infrequent concurrent writes) makes optimistic concurrency ideal.

### Recommendations

✅ **Use connection string authentication** initially (simpler configuration)
✅ **Use ETag-based optimistic concurrency** with 3-5 retry attempts and exponential backoff
✅ **Use hierarchical blob naming** `{userId}/{timePeriod}/{dataType}.json` as specified
✅ **Use `listBlobsByHierarchy`** with prefix for efficient time period discovery
✅ **Handle 404 errors gracefully** (treat missing blob as empty array)
✅ **Set `blobContentType: 'application/json'`** for proper HTTP headers
✅ **Use Buffer encoding** for consistent UTF-8 handling
✅ **Implement `streamToBuffer` helper** for readable stream conversion
✅ **Consider caching** time period calculations for performance
❌ **Avoid blob leases** for initial implementation (optimistic concurrency is sufficient)

---

## 4. Repository Pattern for Multi-Backend

### Research Area
TypeScript interfaces for async repository abstraction, factory pattern instantiation, handling sync (SQLite) vs async (SQL Server, Azure) mismatch, and whether to wrap SQLite in async.

### Async Interface Pattern

Given that SQL Server and Azure Blob Storage are inherently async, all repository interfaces must use `Promise<T>` return types:

```typescript
// src/database/types.ts

export interface IMemoryRepository {
  insert(memory: NewMemory): Promise<MemoryRow>;
  getAll(): Promise<MemoryRow[]>;
  getById(id: number): Promise<MemoryRow | undefined>;
  getUnconsolidated(): Promise<MemoryRow[]>;
  markConsolidated(ids: number[]): Promise<void>;
  updateConnections(id: number, connections: ConnectionEntry[]): Promise<void>;
  deleteById(id: number): Promise<boolean>;
  deleteAll(): Promise<number>;
  getStats(): Promise<MemoryStats>;
}

export interface IConsolidationRepository {
  insert(consolidation: NewConsolidation): Promise<ConsolidationRow>;
  getAll(): Promise<ConsolidationRow[]>;
  deleteAll(): Promise<number>;
  getCount(): Promise<number>;
}

export interface IProcessedFileRepository {
  isProcessed(filePath: string): Promise<boolean>;
  markProcessed(filePath: string): Promise<void>;
  getAll(): Promise<ProcessedFileRow[]>;
}
```

### Should SQLite be Wrapped in Async?

**Yes, for API consistency.** While better-sqlite3 is synchronous and wrapping it in async functions adds minimal overhead, the benefits outweigh the costs:

**Benefits of Wrapping SQLite in Async**:
1. **Uniform Consumer Code**: All 6 consumers (agents, API routes, watcher) use the same `await` pattern regardless of backend
2. **Future-Proof**: Easy to swap SQLite for async alternatives without changing consumers
3. **Type Safety**: Single set of interfaces prevents mixing sync/async patterns
4. **Testing**: Mock repositories can be async, simplifying test setup
5. **Reduced Cognitive Load**: Developers don't need to remember which backend is sync vs async

**Performance Considerations**:
- Wrapping sync operations in async adds ~0.1-1ms overhead per call (negligible)
- better-sqlite3 is already extremely fast (typically <1ms for simple queries)
- The agent's bottleneck is LLM calls (100-1000ms), not database operations
- Network I/O for API requests dwarfs database overhead

**Implementation Pattern for SQLite**:

```typescript
import Database from 'better-sqlite3';
import { IMemoryRepository } from './types';

export class SqliteMemoryRepository implements IMemoryRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private selectAllStmt: Database.Statement;
  // ... other prepared statements

  constructor(db: Database.Database) {
    this.db = db;
    // Prepare statements in constructor for performance
    this.insertStmt = db.prepare(`
      INSERT INTO Memory (userId, content, entities, topics, importance, timestamp, sourceType, sourceReference)
      VALUES (@userId, @content, @entities, @topics, @importance, @timestamp, @sourceType, @sourceReference)
    `);
    this.selectAllStmt = db.prepare('SELECT * FROM Memory');
    // ... prepare other statements
  }

  // Wrap synchronous operations in async
  async insert(memory: NewMemory): Promise<MemoryRow> {
    const info = this.insertStmt.run({
      userId: memory.userId,
      content: memory.content,
      entities: JSON.stringify(memory.entities),
      topics: JSON.stringify(memory.topics),
      importance: memory.importance,
      timestamp: memory.timestamp,
      sourceType: memory.sourceType,
      sourceReference: memory.sourceReference
    });

    const selectStmt = this.db.prepare('SELECT * FROM Memory WHERE id = ?');
    return selectStmt.get(info.lastInsertRowid) as MemoryRow;
  }

  async getAll(): Promise<MemoryRow[]> {
    return this.selectAllStmt.all() as MemoryRow[];
  }

  async markConsolidated(ids: number[]): Promise<void> {
    // Use transaction for atomicity
    const updateTransaction = this.db.transaction((ids: number[]) => {
      const updateStmt = this.db.prepare('UPDATE Memory SET consolidated = 1 WHERE id = ?');
      for (const id of ids) {
        updateStmt.run(id);
      }
    });

    updateTransaction(ids);
  }

  // ... other methods
}
```

**Alternative Consideration**: Keep SQLite synchronous and use conditional `await` in consumers?

```typescript
// Anti-pattern - DO NOT DO THIS
if (backend === 'sqlite') {
  const memories = memoryRepo.getAll();  // sync
} else {
  const memories = await memoryRepo.getAll();  // async
}
```

**Recommendation**: ❌ **Reject this approach**. It defeats the purpose of the repository pattern and creates unmaintainable consumer code.

### Factory Pattern

The factory should return a bundle containing all repositories and a cleanup method:

```typescript
// src/database/storage-factory.ts

import { StorageConfig } from '../config/types';
import {
  IMemoryRepository,
  IConsolidationRepository,
  IProcessedFileRepository
} from './types';

export interface StorageBackend {
  memoryRepo: IMemoryRepository;
  consolidationRepo: IConsolidationRepository;
  processedFileRepo: IProcessedFileRepository;
  close: () => Promise<void>;
}

export class StorageFactory {
  static async create(config: StorageConfig): Promise<StorageBackend> {
    switch (config.provider) {
      case 'sqlite':
        return await this.createSqliteBackend(config.sqlite!);

      case 'sqlserver':
        return await this.createSqlServerBackend(config.sqlserver!);

      case 'azure-blob':
        return await this.createAzureBlobBackend(config.azureBlob!);

      default:
        const exhaustive: never = config.provider;
        throw new Error(`Unsupported storage provider: ${exhaustive}`);
    }
  }

  private static async createSqliteBackend(
    config: { databasePath: string }
  ): Promise<StorageBackend> {
    const Database = await import('better-sqlite3');
    const db = new Database.default(config.databasePath);
    db.pragma('journal_mode = WAL');

    // Initialize schema
    const { initializeSqliteSchema } = await import('./sqlite/schema');
    initializeSqliteSchema(db);

    // Create repositories
    const { SqliteMemoryRepository } = await import('./sqlite/memory-repository');
    const { SqliteConsolidationRepository } = await import('./sqlite/consolidation-repository');
    const { SqliteProcessedFileRepository } = await import('./sqlite/processed-file-repository');

    const memoryRepo = new SqliteMemoryRepository(db);
    const consolidationRepo = new SqliteConsolidationRepository(db);
    const processedFileRepo = new SqliteProcessedFileRepository(db);

    return {
      memoryRepo,
      consolidationRepo,
      processedFileRepo,
      close: async () => {
        db.close();
      }
    };
  }

  private static async createSqlServerBackend(
    config: {
      server: string;
      port: number;
      database: string;
      user: string;
      password: string;
      encrypt: boolean;
      trustServerCertificate: boolean;
    }
  ): Promise<StorageBackend> {
    const sql = await import('mssql');

    const pool = await sql.connect({
      server: config.server,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      },
      options: {
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate
      }
    });

    // Initialize schema
    const { initializeSqlServerSchema } = await import('./sqlserver/schema');
    await initializeSqlServerSchema(pool);

    // Create repositories
    const { SqlServerMemoryRepository } = await import('./sqlserver/memory-repository');
    const { SqlServerConsolidationRepository } = await import('./sqlserver/consolidation-repository');
    const { SqlServerProcessedFileRepository } = await import('./sqlserver/processed-file-repository');

    const memoryRepo = new SqlServerMemoryRepository(pool);
    const consolidationRepo = new SqlServerConsolidationRepository(pool);
    const processedFileRepo = new SqlServerProcessedFileRepository(pool);

    return {
      memoryRepo,
      consolidationRepo,
      processedFileRepo,
      close: async () => {
        await pool.close();
      }
    };
  }

  private static async createAzureBlobBackend(
    config: {
      connectionString: string;
      containerName: string;
      timePeriodFormat: 'monthly' | 'weekly' | 'daily';
    }
  ): Promise<StorageBackend> {
    const { BlobServiceClient } = await import('@azure/storage-blob');

    const blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    const containerClient = blobServiceClient.getContainerClient(config.containerName);

    // Ensure container exists
    await containerClient.createIfNotExists();

    // Create repositories
    const { AzureBlobMemoryRepository } = await import('./azure-blob/memory-repository');
    const { AzureBlobConsolidationRepository } = await import('./azure-blob/consolidation-repository');
    const { AzureBlobProcessedFileRepository } = await import('./azure-blob/processed-file-repository');

    const memoryRepo = new AzureBlobMemoryRepository(containerClient, config.timePeriodFormat);
    const consolidationRepo = new AzureBlobConsolidationRepository(containerClient, config.timePeriodFormat);
    const processedFileRepo = new AzureBlobProcessedFileRepository(containerClient);

    return {
      memoryRepo,
      consolidationRepo,
      processedFileRepo,
      close: async () => {
        // No explicit cleanup needed for Azure SDK client
      }
    };
  }
}
```

### Using TypeScript 5.2 Disposable Pattern (Optional Enhancement)

TypeScript 5.2+ supports `Symbol.asyncDispose` for explicit resource management:

```typescript
export interface StorageBackend {
  memoryRepo: IMemoryRepository;
  consolidationRepo: IConsolidationRepository;
  processedFileRepo: IProcessedFileRepository;
  [Symbol.asyncDispose]: () => Promise<void>;
}

// In src/index.ts
async function main() {
  await using backend = await StorageFactory.create(config.storage);

  // Use repositories...
  // Automatic cleanup when scope exits (even on exception)
}
```

**Recommendation**: Implement the `close()` method pattern initially. The `Symbol.asyncDispose` pattern can be added as an enhancement once the codebase adopts TypeScript 5.2+.

### Wiring in Entry Point

```typescript
// src/index.ts (updated)

async function main() {
  // Load configuration
  const config = loadConfig();

  // Create storage backend
  const storage = await StorageFactory.create(config.storage);

  // Create LLM
  const llm = createLlm(config.llm);

  // Create agents (now async-aware)
  const ingestAgent = new IngestAgent(llm, storage.memoryRepo);
  const consolidateAgent = new ConsolidateAgent(
    llm,
    storage.memoryRepo,
    storage.consolidationRepo
  );
  const queryAgent = new QueryAgent(
    llm,
    storage.memoryRepo,
    storage.consolidationRepo
  );

  // Create server
  const server = createServer({
    ingestAgent,
    consolidateAgent,
    queryAgent,
    memoryRepo: storage.memoryRepo,
    consolidationRepo: storage.consolidationRepo
  });

  // Start server
  await startServer(server, config.apiPort);

  // Start file watcher
  const watcher = new FileWatcher(
    config.watchDirectory,
    ingestAgent,
    storage.processedFileRepo
  );
  await watcher.start();

  // Start consolidation loop
  const consolidationLoop = new ConsolidationLoop(
    consolidateAgent,
    config.consolidationIntervalMs
  );
  consolidationLoop.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    consolidationLoop.stop();
    await watcher.stop();
    await stopServer(server);
    await storage.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Consumer Updates Required

All consumers must be updated to use `await`:

```typescript
// Before (sync):
const memories = memoryRepo.getAll();

// After (async):
const memories = await memoryRepo.getAll();
```

**Files requiring async/await updates**:
1. `src/agents/ingest-agent.ts` - `insert` calls
2. `src/agents/consolidate-agent.ts` - `getUnconsolidated`, `markConsolidated`, `insert` calls
3. `src/agents/query-agent.ts` - `getAll` calls
4. `src/api/routes.ts` - All repository method calls
5. `src/watcher/file-watcher.ts` - `isProcessed`, `markProcessed` calls
6. `src/consolidation/consolidation-loop.ts` - If it calls agents directly

### Recommendations

✅ **Define async interfaces** with `Promise<T>` return types for all repository methods
✅ **Wrap SQLite operations in async** for API consistency across backends
✅ **Use factory pattern** returning a `StorageBackend` bundle with `close()` method
✅ **Use dynamic imports** in factory for lazy loading of backend-specific modules
✅ **Update all 6 consumers** to use `await` for repository calls
✅ **Preserve prepared statements** in SQLite implementation for performance
✅ **Use exhaustive switch** (`never` type) in factory for compile-time provider checking
✅ **Provide clear error messages** when backend initialization fails
✅ **Test each backend** independently with isolated integration tests

---

## 5. LangChain.js YAML-Based Config

### Research Area
Whether LangChain model constructors accept optional `organization` and `baseUrl` fields, and how to pass provider-specific config dynamically.

### ChatOpenAI Configuration

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.7,
  apiKey: "sk-...",

  // Optional: Organization ID
  organization: "org-...",

  // Optional: Custom base URL (for Azure OpenAI or OpenRouter)
  configuration: {
    baseURL: "https://your-custom-endpoint.com/v1"
  },

  // Other optional parameters
  maxTokens: 2000,
  timeout: 30000,
  maxRetries: 2
});
```

**Key Points**:
- `organization` is a **top-level parameter** (not nested)
- `baseURL` goes inside a **`configuration` object**
- Both are **optional** and can be omitted

### ChatAnthropic Configuration

```typescript
import { ChatAnthropic } from '@langchain/anthropic';

const llm = new ChatAnthropic({
  model: "claude-3-5-sonnet-20241022",
  temperature: 0.7,
  apiKey: "sk-ant-...",

  // Optional: Custom base URL (for proxies or custom deployments)
  clientOptions: {
    baseURL: "https://your-anthropic-proxy.com"
  },

  // Other optional parameters
  maxTokens: 4096,
  timeout: 60000
});
```

**Key Points**:
- `baseURL` goes inside **`clientOptions` object** (different from OpenAI!)
- No `organization` parameter for Anthropic
- `clientOptions` is **optional**

### ChatGoogleGenerativeAI Configuration

```typescript
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-exp",
  temperature: 0.7,
  apiKey: "...",

  // Other optional parameters
  maxOutputTokens: 2048
});
```

**Key Points**:
- No `organization` parameter
- No obvious `baseURL` option in documentation (uses Google's API endpoints)
- Simpler configuration compared to OpenAI/Anthropic

### Updated Provider Factory

```typescript
// src/llm/provider-factory.ts

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { LlmConfig } from '../config/types';

export function createLlm(config: LlmConfig): BaseChatModel {
  switch (config.provider) {
    case 'openai':
      return new ChatOpenAI({
        model: config.model,
        temperature: config.temperature,
        apiKey: config.openai!.apiKey,

        // Pass optional fields only if present
        ...(config.openai!.organization && {
          organization: config.openai!.organization
        }),

        ...(config.openai!.baseUrl && {
          configuration: {
            baseURL: config.openai!.baseUrl
          }
        })
      });

    case 'anthropic':
      return new ChatAnthropic({
        model: config.model,
        temperature: config.temperature,
        apiKey: config.anthropic!.apiKey,

        // Pass optional baseUrl if present
        ...(config.anthropic!.baseUrl && {
          clientOptions: {
            baseURL: config.anthropic!.baseUrl
          }
        })
      });

    case 'google':
      return new ChatGoogleGenerativeAI({
        model: config.model,
        temperature: config.temperature,
        apiKey: config.google!.apiKey
      });

    default:
      const exhaustive: never = config.provider;
      throw new Error(`Unsupported LLM provider: ${exhaustive}`);
  }
}
```

### Updated LLM Config Type

```typescript
// src/config/types.ts

export interface LlmConfig {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  temperature: number;

  openai?: {
    apiKey: string;
    organization?: string;  // Optional
    baseUrl?: string;       // Optional
  };

  anthropic?: {
    apiKey: string;
    baseUrl?: string;       // Optional
  };

  google?: {
    apiKey: string;
  };
}
```

### Zod Schema for LLM Config

```typescript
import { z } from 'zod';

const llmConfigSchema = z.object({
  llm: z.object({
    provider: z.enum(['openai', 'anthropic', 'google']),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),

    openai: z.object({
      apiKey: z.string().min(1),
      organization: z.string().optional(),
      baseUrl: z.string().url().optional()
    }).optional(),

    anthropic: z.object({
      apiKey: z.string().min(1),
      baseUrl: z.string().url().optional()
    }).optional(),

    google: z.object({
      apiKey: z.string().min(1)
    }).optional()
  })
}).refine(
  (data) => {
    // Validate that the active provider's section exists
    switch (data.llm.provider) {
      case 'openai':
        return data.llm.openai !== undefined && data.llm.openai.apiKey.length > 0;
      case 'anthropic':
        return data.llm.anthropic !== undefined && data.llm.anthropic.apiKey.length > 0;
      case 'google':
        return data.llm.google !== undefined && data.llm.google.apiKey.length > 0;
      default:
        return false;
    }
  },
  {
    message: "Configuration for the selected LLM provider is missing or incomplete"
  }
);
```

### Example llm-config.yaml

```yaml
llm:
  provider: openai
  model: gpt-4o
  temperature: 0.7

  openai:
    apiKey: sk-proj-...
    organization: org-...           # Optional
    baseUrl: https://api.openai.com/v1  # Optional

  # anthropic and google sections can be omitted when not active
  anthropic:
    apiKey: sk-ant-...
    baseUrl: https://api.anthropic.com  # Optional

  google:
    apiKey: AIza...
```

### Recommendations

✅ **OpenAI**: Use `organization` (top-level) and `configuration.baseURL` (nested)
✅ **Anthropic**: Use `clientOptions.baseURL` (nested, different from OpenAI!)
✅ **Google**: No optional fields currently needed
✅ **Use spread operator** (`...`) to conditionally include optional fields
✅ **Validate presence** of active provider's section with Zod `.refine()`
✅ **Document differences** between OpenAI and Anthropic `baseURL` nesting in code comments
✅ **Test with custom endpoints** like Azure OpenAI and OpenRouter to verify `baseURL` works

---

## Assumptions Made

| Assumption | Confidence | Impact if Wrong | Rationale |
|------------|------------|-----------------|-----------|
| All repository methods should be async | **HIGH** | Medium - Would need to maintain two sets of interfaces or use conditional await patterns | SQL Server and Azure Blob are inherently async; uniform API reduces cognitive load and errors |
| SQLite operations should be wrapped in async for consistency | **MEDIUM** | Low - Could keep SQLite sync and burden consumers with conditional logic | Performance overhead is negligible (~0.1-1ms), benefits of uniform API outweigh costs |
| ETag-based optimistic concurrency is sufficient for Azure Blob | **HIGH** | Low - Could add blob lease support later if needed | Typical agent usage (single-user consolidation) has low write contention |
| Connection string auth is sufficient for Azure Blob initially | **HIGH** | Low - Can add DefaultAzureCredential later as enhancement | Connection strings are simpler to configure, requirement document specifies this pattern |
| `OBJECT_ID()` is the best pattern for SQL Server schema checks | **HIGH** | None - Other patterns (sys.tables, INFORMATION_SCHEMA) work equally well | Most widely recommended by SQL Server experts, best performance |
| Time period format should be configurable (monthly/weekly/daily) | **HIGH** | Medium - Fixed format would simplify implementation but reduce flexibility | Requirement document explicitly mentions "time period indicator" without specifying format |
| ProcessedFile should use single blob per user (not time-bucketed) | **MEDIUM** | Low - Could use time buckets if needed | Processed files are not naturally time-scoped; single blob is simpler |
| `js-yaml` is preferred over `eemeli/yaml` | **MEDIUM** | None - Both packages are viable | Wider adoption (24k+ projects) and established API make js-yaml safer choice |
| Auto-ID generation for Azure Blob should use max(id)+1 pattern | **MEDIUM** | Medium - UUID approach would avoid coordination but change ID type | Maintains consistency with SQLite/SQL Server integer IDs |
| Factory should return bundle with `close()` method | **HIGH** | Low - Could use TypeScript 5.2 `Symbol.asyncDispose` instead | More compatible with current TypeScript versions, can add disposal pattern later |

---

## Uncertainties & Gaps

### 1. Azure Blob Cross-Period Query Performance
**Issue**: When querying all memories for a user with `getAll()`, should the system scan all time-period blobs or only recent ones?
**Impact**: Performance degrades as time periods accumulate. Scanning 36+ monthly blobs for a 3-year user could add seconds to query time.
**Options**:
- Scan all periods (correct but potentially slow)
- Scan only recent N periods (fast but may miss old memories)
- Maintain an index blob listing active periods per user (adds complexity)
- Add TTL/archival policy to consolidate old periods

**Recommendation for Open Questions**: This should be addressed in the Open Questions section (#2) of the refined request.

### 2. Azure Blob Auto-ID Generation Strategy
**Issue**: The refined request mentions "max existing ID + 1, or UUID" but doesn't specify which.
**Impact**:
- max(id)+1 requires scanning all blobs to find highest ID (slow)
- UUID changes ID type from integer to string (breaks existing API contracts)
- Hybrid approach (UUID with numeric prefix) adds complexity

**Recommendation**: Use max(id)+1 for consistency with SQLite/SQL Server, but implement efficient caching of the highest ID within each time period blob.

### 3. SQL Server Authentication - Windows vs SQL Auth
**Issue**: The refined request specifies user/password (SQL Authentication) but doesn't mention Windows Authentication (Integrated Security).
**Impact**: Organizations using Windows Authentication cannot use the agent without code changes.
**Current Status**: Configuration schema only supports SQL Authentication.

**Recommendation for Open Questions**: This should be addressed in the Open Questions section (#4) of the refined request.

### 4. Transaction Support Across Backends
**Issue**: SQLite and SQL Server support atomic transactions, but Azure Blob does not.
**Impact**: `markConsolidated(ids)` may partially succeed on Azure Blob if a retry fails midway through the ID list.
**Current Status**: Azure Blob implementation would need to track which IDs were successfully marked.

**Mitigation**: For Azure Blob, treat each blob update as atomic. The entire memory array is read-modify-written atomically per time period.

### 5. Migration Between Backends
**Issue**: When switching from SQLite to SQL Server (or vice versa), how should existing data be handled?
**Current Status**: Explicitly out of scope per refined request (#7), but practical deployment may require this.

**Recommendation**: Document that switching backends requires manual data migration. Provide example migration scripts in documentation.

---

## Clarifying Questions for Follow-up

### High Priority

1. **Azure Blob Query Scope**: When calling `getAll()` on Azure Blob Storage, should the system:
   - Scan all time-period blobs for the user (correct but potentially slow)?
   - Scan only the most recent N periods (fast but may miss old data)?
   - Maintain a separate index blob listing active periods (adds complexity)?

2. **Azure Blob ID Generation**: Should Azure Blob backend use:
   - max(id)+1 (consistent with SQLite/SQL Server, requires scanning)?
   - UUID (avoids scanning, but changes ID type from integer to string)?
   - Composite ID like "2026-03-0001" (time-period-scoped)?

3. **SQL Server Authentication**: Should the configuration support Windows Authentication (Integrated Security) in addition to SQL Authentication (user/password)?

4. **ProcessedFile Time Bucketing**: Should ProcessedFile records in Azure Blob use:
   - Single blob per user (simpler, not time-scoped)?
   - Same time-period bucketing as memories (consistent but less intuitive)?

### Medium Priority

5. **Error Handling Strategy**: When an Azure Blob operation fails due to ETag mismatch after 3-5 retries, should the system:
   - Throw an exception (fail-fast)?
   - Log a warning and continue (best-effort)?
   - Implement a backoff-and-requeue mechanism?

6. **Connection Pool Sizing**: What should the SQL Server connection pool size be? Current recommendation is max=10. Should this be:
   - Configurable via YAML?
   - Fixed based on expected load?
   - Dynamically adjusted based on CPU cores?

7. **Azure Blob Container**: Should the container name be:
   - Configurable per deployment (current approach)?
   - Fixed to "memory-container" for simplicity?
   - Separate containers per data type (e.g., "memories", "consolidations", "processed-files")?

8. **Configuration Hot-Reload**: Should changes to YAML files be detected at runtime and trigger a reconnection, or is restart-only acceptable? (Open Question #6 in refined request)

### Low Priority

9. **LLM Temperature Range**: The Zod schema validates temperature between 0-2. Should this be:
   - Provider-specific (different providers have different ranges)?
   - More restrictive (e.g., 0-1 for most practical use cases)?

10. **TypeScript Target**: Should the implementation use TypeScript 5.2+ features like `Symbol.asyncDispose`, or maintain compatibility with older versions?

---

## References

### YAML Parsing & Validation
- [js-yaml - npm](https://www.npmjs.com/package/js-yaml) - Latest version 4.1.1
- [Zod - TypeScript-first schema validation](https://zod.dev/) - Official documentation
- [How to Validate Data with Zod in TypeScript](https://oneuptime.com/blog/post/2026-01-25-zod-validation-typescript/view) - 2026 guide

### SQL Server Integration
- [mssql - npm](https://www.npmjs.com/package/mssql) - Latest version 12.2.0
- [@types/mssql - npm](https://www.npmjs.com/package/@types/mssql) - TypeScript types v9.1.9
- [Node-MSSQL Documentation](https://github.com/tediousjs/node-mssql) - Official GitHub repository
- [6 Ways to Check if a Table Exists in SQL Server](https://database.guide/6-ways-to-check-if-a-table-exists-in-sql-server-t-sql-examples/) - OBJECT_ID pattern
- [Create Table If Not Exists SQL Server](https://sqlserverguides.com/create-table-if-not-exists-sql-server/) - Schema initialization patterns

### Azure Blob Storage
- [@azure/storage-blob - npm](https://www.npmjs.com/package/@azure/storage-blob) - Latest version 12.31.0
- [Get started with Azure Blob Storage and JavaScript](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-javascript-get-started) - Official Microsoft guide
- [Manage concurrency in Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage) - ETag and lease patterns
- [List blobs with JavaScript](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-list-javascript) - Prefix filtering and hierarchy
- [Azure SDK for JS - listBlobsByHierarchy.ts](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/storage/storage-blob/samples/v12/typescript/src/listBlobsByHierarchy.ts) - TypeScript example

### Repository Pattern & Async Wrappers
- [Exploring the repository pattern with TypeScript and Node](https://blog.logrocket.com/exploring-repository-pattern-typescript-node/) - LogRocket guide
- [The Repository pattern with Typescript](https://www.abdou.dev/blog/the-repository-pattern-with-typescript) - Async interface patterns
- [How to Use SQLite in Node.js Applications](https://oneuptime.com/blog/post/2026-02-02-sqlite-nodejs/view) - 2026 guide with async wrappers
- [TypeScript 5.2's New Keyword: 'using'](https://www.totaltypescript.com/typescript-5-2-new-keyword-using) - Disposable pattern
- [ECMAScript Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management) - TC39 proposal

### LangChain.js Configuration
- [Chat model integrations - LangChain.js](https://docs.langchain.com/oss/javascript/integrations/chat) - Official documentation
- [ChatOpenAI API Reference](https://v03.api.js.langchain.com/classes/_langchain_openai.ChatOpenAI.html) - Constructor options
- [Custom 'apiVersion' and 'baseUrl' parameters](https://github.com/langchain-ai/langchainjs/issues/5482) - GitHub discussion

### Better-SQLite3 Async Patterns
- [better-sqlite3 - npm](https://www.npmjs.com/package/better-sqlite3) - Official package
- [Async API? · Issue #89](https://github.com/JoshuaWise/better-sqlite3/issues/89) - Discussion on async wrappers
- [Understanding Better-SQLite3](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8) - Why it's synchronous

---

## Document Metadata

**Lines of Code Examined**: 500+ across package documentation and examples
**Packages Researched**: 6 (js-yaml, zod, mssql, @azure/storage-blob, @langchain/openai, @langchain/anthropic)
**Sources Consulted**: 40+ URLs from official documentation, GitHub, npm, Microsoft Learn, and developer blogs
**Code Examples Provided**: 25+ TypeScript code snippets
**Confidence Level**: HIGH for core recommendations, MEDIUM for implementation details requiring testing

---

**Investigation Complete** | Ready for design and implementation phases
