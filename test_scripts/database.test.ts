import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase, closeDatabase } from '../src/database/connection.js';
import { MemoryRepository } from '../src/database/memory-repository.js';
import { ConsolidationRepository } from '../src/database/consolidation-repository.js';
import { ProcessedFileRepository } from '../src/database/processed-file-repository.js';
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

// ─── initializeDatabase ──────────────────────────────────────────────────────

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

// ─── MemoryRepository ────────────────────────────────────────────────────────

describe('MemoryRepository', () => {
  let db: Database.Database;
  let repo: MemoryRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new MemoryRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('insert() creates a memory and returns it with an id', () => {
    const row = repo.insert(sampleMemory());

    expect(row.id).toBeTypeOf('number');
    expect(row.id).toBeGreaterThan(0);
    expect(row.source).toBe('test');
    expect(row.summary).toBe('Test memory summary.');
    expect(row.consolidated).toBe(0);
    expect(row.connections).toBe('[]');
    expect(row.createdAt).toBeTruthy();
  });

  it('getAll() returns all inserted memories', () => {
    repo.insert(sampleMemory({ rawText: 'first' }));
    repo.insert(sampleMemory({ rawText: 'second' }));
    repo.insert(sampleMemory({ rawText: 'third' }));

    const all = repo.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]!.rawText).toBe('first');
    expect(all[2]!.rawText).toBe('third');
  });

  it('getById() returns the correct memory', () => {
    const inserted = repo.insert(sampleMemory());
    const found = repo.getById(inserted.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted.id);
    expect(found!.summary).toBe(inserted.summary);
  });

  it('getById() returns undefined for a non-existent id', () => {
    const found = repo.getById(99999);
    expect(found).toBeUndefined();
  });

  it('getUnconsolidated() returns only unconsolidated memories', () => {
    const m1 = repo.insert(sampleMemory({ rawText: 'one' }));
    repo.insert(sampleMemory({ rawText: 'two' }));
    repo.markConsolidated([m1.id]);

    const unconsolidated = repo.getUnconsolidated();
    expect(unconsolidated).toHaveLength(1);
    expect(unconsolidated[0]!.rawText).toBe('two');
  });

  it('markConsolidated() marks memories as consolidated', () => {
    const m1 = repo.insert(sampleMemory());
    const m2 = repo.insert(sampleMemory());
    repo.markConsolidated([m1.id, m2.id]);

    const r1 = repo.getById(m1.id);
    const r2 = repo.getById(m2.id);
    expect(r1!.consolidated).toBe(1);
    expect(r2!.consolidated).toBe(1);
  });

  it('deleteById() deletes an existing memory and returns true', () => {
    const m = repo.insert(sampleMemory());
    const deleted = repo.deleteById(m.id);

    expect(deleted).toBe(true);
    expect(repo.getById(m.id)).toBeUndefined();
  });

  it('deleteById() returns false for a non-existent id', () => {
    const deleted = repo.deleteById(99999);
    expect(deleted).toBe(false);
  });

  it('deleteAll() clears all memories and returns the count', () => {
    repo.insert(sampleMemory());
    repo.insert(sampleMemory());
    repo.insert(sampleMemory());

    const count = repo.deleteAll();
    expect(count).toBe(3);
    expect(repo.getAll()).toHaveLength(0);
  });

  it('getStats() returns correct counts', () => {
    repo.insert(sampleMemory());
    const m2 = repo.insert(sampleMemory());
    repo.insert(sampleMemory());
    repo.markConsolidated([m2.id]);

    // Insert a consolidation row so consolidations count is non-zero
    const consolidationRepo = new ConsolidationRepository(db);
    consolidationRepo.insert(sampleConsolidation());

    const stats = repo.getStats();
    expect(stats.total).toBe(3);
    expect(stats.consolidated).toBe(1);
    expect(stats.unconsolidated).toBe(2);
    expect(stats.consolidations).toBe(1);
  });
});

// ─── ConsolidationRepository ─────────────────────────────────────────────────

describe('ConsolidationRepository', () => {
  let db: Database.Database;
  let repo: ConsolidationRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new ConsolidationRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('insert() creates a consolidation and getAll() returns it', () => {
    const row = repo.insert(sampleConsolidation());

    expect(row.id).toBeGreaterThan(0);
    expect(row.summary).toBe('Consolidated summary.');
    expect(row.insight).toBe('Consolidated insight.');
    expect(row.createdAt).toBeTruthy();

    const all = repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(row.id);
  });

  it('deleteAll() removes all rows and returns the count', () => {
    repo.insert(sampleConsolidation());
    repo.insert(sampleConsolidation());

    const count = repo.deleteAll();
    expect(count).toBe(2);
    expect(repo.getAll()).toHaveLength(0);
  });

  it('getCount() returns the total number of consolidation rows', () => {
    expect(repo.getCount()).toBe(0);
    repo.insert(sampleConsolidation());
    repo.insert(sampleConsolidation());
    expect(repo.getCount()).toBe(2);
  });
});

// ─── ProcessedFileRepository ─────────────────────────────────────────────────

describe('ProcessedFileRepository', () => {
  let db: Database.Database;
  let repo: ProcessedFileRepository;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    repo = new ProcessedFileRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('isProcessed() returns false for a file that has not been processed', () => {
    expect(repo.isProcessed('/tmp/unknown-file.txt')).toBe(false);
  });

  it('markProcessed() marks a file and isProcessed() returns true', () => {
    repo.markProcessed('/tmp/test-file.txt');
    expect(repo.isProcessed('/tmp/test-file.txt')).toBe(true);
  });

  it('duplicate markProcessed() is silently ignored (INSERT OR IGNORE)', () => {
    repo.markProcessed('/tmp/dup-file.txt');
    // The SQL uses INSERT OR IGNORE, so a second call should NOT throw.
    expect(() => repo.markProcessed('/tmp/dup-file.txt')).not.toThrow();
    // Still only one row in the table
    const all = repo.getAll();
    expect(all).toHaveLength(1);
  });
});
