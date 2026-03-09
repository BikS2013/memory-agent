import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, closeDatabase } from '../src/database/sqlite/sqlite-connection.js';
import { SqliteMemoryRepository } from '../src/database/sqlite/sqlite-memory-repository.js';
import { SqliteConsolidationRepository } from '../src/database/sqlite/sqlite-consolidation-repository.js';
import { SqliteProcessedFileRepository } from '../src/database/sqlite/sqlite-processed-file-repository.js';
import type { NewMemory, NewConsolidation } from '../src/database/types.js';

/**
 * Helper: creates a sample NewMemory object.
 */
function sampleMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    source: 'test',
    rawText: 'This is a raw test memory.',
    summary: 'Test memory summary.',
    entities: JSON.stringify(['entity-a']),
    topics: JSON.stringify(['topic-a']),
    importance: 0.5,
    ...overrides,
  };
}

/**
 * Helper: creates a sample NewConsolidation object.
 */
function sampleConsolidation(overrides: Partial<NewConsolidation> = {}): NewConsolidation {
  return {
    userId: 'default',
    sourceIds: JSON.stringify([1, 2]),
    summary: 'Consolidated summary.',
    insight: 'Consolidated insight.',
    ...overrides,
  };
}

// --- initializeDatabase ---

describe('initializeDatabase', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) closeDatabase(db);
  });

  it('creates Memory, Consolidation, and ProcessedFile tables', () => {
    db = initializeDatabase(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('Memory');
    expect(tableNames).toContain('Consolidation');
    expect(tableNames).toContain('ProcessedFile');
  });
});

// --- SqliteMemoryRepository ---

describe('SqliteMemoryRepository', () => {
  let db: Database.Database;
  let repo: SqliteMemoryRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new SqliteMemoryRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('insert() creates a memory and returns it with an id', async () => {
    const row = await repo.insert(sampleMemory());

    expect(row.id).toBeTypeOf('number');
    expect(row.id).toBeGreaterThan(0);
    expect(row.source).toBe('test');
    expect(row.summary).toBe('Test memory summary.');
    expect(row.consolidated).toBe(0);
    expect(row.connections).toBe('[]');
    expect(row.createdAt).toBeTruthy();
  });

  it('getAll() returns all inserted memories', async () => {
    await repo.insert(sampleMemory({ rawText: 'first' }));
    await repo.insert(sampleMemory({ rawText: 'second' }));
    await repo.insert(sampleMemory({ rawText: 'third' }));

    const all = await repo.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]!.rawText).toBe('first');
    expect(all[2]!.rawText).toBe('third');
  });

  it('getById() returns the correct memory', async () => {
    const inserted = await repo.insert(sampleMemory());
    const found = await repo.getById(inserted.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    expect(found!.summary).toBe(inserted.summary);
  });

  it('getById() returns undefined for a non-existent id', async () => {
    const found = await repo.getById(99999);
    expect(found).toBeUndefined();
  });

  it('getUnconsolidated() returns only unconsolidated memories', async () => {
    const m1 = await repo.insert(sampleMemory({ rawText: 'one' }));
    await repo.insert(sampleMemory({ rawText: 'two' }));
    await repo.markConsolidated([m1.id]);

    const unconsolidated = await repo.getUnconsolidated();
    expect(unconsolidated).toHaveLength(1);
    expect(unconsolidated[0]!.rawText).toBe('two');
  });

  it('markConsolidated() marks memories as consolidated', async () => {
    const m1 = await repo.insert(sampleMemory());
    const m2 = await repo.insert(sampleMemory());
    await repo.markConsolidated([m1.id, m2.id]);

    const r1 = await repo.getById(m1.id);
    const r2 = await repo.getById(m2.id);
    expect(r1!.consolidated).toBe(1);
    expect(r2!.consolidated).toBe(1);
  });

  it('deleteById() deletes an existing memory and returns true', async () => {
    const m = await repo.insert(sampleMemory());
    const deleted = await repo.deleteById(m.id);

    expect(deleted).toBe(true);
    expect(await repo.getById(m.id)).toBeUndefined();
  });

  it('deleteById() returns false for a non-existent id', async () => {
    const deleted = await repo.deleteById(99999);
    expect(deleted).toBe(false);
  });

  it('deleteAll() clears all memories and returns the count', async () => {
    await repo.insert(sampleMemory());
    await repo.insert(sampleMemory());
    await repo.insert(sampleMemory());

    const count = await repo.deleteAll();
    expect(count).toBe(3);
    expect(await repo.getAll()).toHaveLength(0);
  });

  it('getStats() returns correct counts', async () => {
    await repo.insert(sampleMemory());
    const m2 = await repo.insert(sampleMemory());
    await repo.insert(sampleMemory());
    await repo.markConsolidated([m2.id]);

    // Insert a consolidation row so consolidations count is non-zero
    const consolidationRepo = new SqliteConsolidationRepository(db);
    await consolidationRepo.insert(sampleConsolidation());

    const stats = await repo.getStats();
    expect(stats.total).toBe(3);
    expect(stats.consolidated).toBe(1);
    expect(stats.unconsolidated).toBe(2);
    expect(stats.consolidations).toBe(1);
  });
});

// --- SqliteConsolidationRepository ---

describe('SqliteConsolidationRepository', () => {
  let db: Database.Database;
  let repo: SqliteConsolidationRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new SqliteConsolidationRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('insert() creates a consolidation and getAll() returns it', async () => {
    const row = await repo.insert(sampleConsolidation());

    expect(row.id).toBeGreaterThan(0);
    expect(row.summary).toBe('Consolidated summary.');
    expect(row.insight).toBe('Consolidated insight.');
    expect(row.createdAt).toBeTruthy();

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(row.id);
  });

  it('deleteAll() removes all rows and returns the count', async () => {
    await repo.insert(sampleConsolidation());
    await repo.insert(sampleConsolidation());

    const count = await repo.deleteAll();
    expect(count).toBe(2);
    expect(await repo.getAll()).toHaveLength(0);
  });

  it('getCount() returns the total number of consolidation rows', async () => {
    expect(await repo.getCount()).toBe(0);
    await repo.insert(sampleConsolidation());
    await repo.insert(sampleConsolidation());
    expect(await repo.getCount()).toBe(2);
  });
});

// --- SqliteProcessedFileRepository ---

describe('SqliteProcessedFileRepository', () => {
  let db: Database.Database;
  let repo: SqliteProcessedFileRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new SqliteProcessedFileRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('isProcessed() returns false for a file that has not been processed', async () => {
    expect(await repo.isProcessed('/tmp/unknown-file.txt')).toBe(false);
  });

  it('markProcessed() marks a file and isProcessed() returns true', async () => {
    await repo.markProcessed('/tmp/test-file.txt');
    expect(await repo.isProcessed('/tmp/test-file.txt')).toBe(true);
  });

  it('duplicate markProcessed() is silently ignored (INSERT OR IGNORE)', async () => {
    await repo.markProcessed('/tmp/dup-file.txt');
    // The SQL uses INSERT OR IGNORE, so a second call should NOT throw.
    await expect(repo.markProcessed('/tmp/dup-file.txt')).resolves.not.toThrow();
    // Still only one row in the table
    const all = await repo.getAll();
    expect(all).toHaveLength(1);
  });
});
