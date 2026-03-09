/**
 * StorageFactory tests.
 * Verifies that createStorage returns a working StorageBundle for sqlite
 * and throws for unknown providers.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createStorage } from '../src/database/storage-factory.js';
import type { StorageBundle } from '../src/database/interfaces.js';
import type { StorageConfig } from '../src/config/types.js';

describe('createStorage()', () => {
  let bundle: StorageBundle | undefined;

  afterEach(async () => {
    if (bundle) {
      await bundle.close();
      bundle = undefined;
    }
  });

  it('returns a working StorageBundle for sqlite provider', async () => {
    const config: StorageConfig = {
      provider: 'sqlite',
      sqlite: { databasePath: ':memory:' },
    };

    bundle = await createStorage(config);

    expect(bundle).toBeDefined();
    expect(bundle.memoryRepo).toBeDefined();
    expect(bundle.consolidationRepo).toBeDefined();
    expect(bundle.processedFileRepo).toBeDefined();
    expect(typeof bundle.close).toBe('function');

    // Verify the repos are functional
    const inserted = await bundle.memoryRepo.insert({
      source: 'test',
      rawText: 'Hello world',
      summary: 'Greeting',
      entities: '[]',
      topics: '[]',
      importance: 0.5,
    });
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.source).toBe('test');

    const all = await bundle.memoryRepo.getAll();
    expect(all).toHaveLength(1);

    const stats = await bundle.memoryRepo.getStats();
    expect(stats.total).toBe(1);
    expect(stats.unconsolidated).toBe(1);

    // Verify consolidation repo works
    const consolidation = await bundle.consolidationRepo.insert({
      userId: 'default',
      sourceIds: JSON.stringify([inserted.id]),
      summary: 'Test consolidation',
      insight: 'Test insight',
    });
    expect(consolidation.id).toBeGreaterThan(0);
    expect(await bundle.consolidationRepo.getCount()).toBe(1);

    // Verify processed file repo works
    expect(await bundle.processedFileRepo.isProcessed('/tmp/test.txt')).toBe(false);
    await bundle.processedFileRepo.markProcessed('/tmp/test.txt');
    expect(await bundle.processedFileRepo.isProcessed('/tmp/test.txt')).toBe(true);
  });

  it('throws for unknown provider', async () => {
    const config = {
      provider: 'unknown-provider',
    } as unknown as StorageConfig;

    await expect(createStorage(config)).rejects.toThrow();
  });

  it('throws when sqlite config section is missing', async () => {
    const config: StorageConfig = {
      provider: 'sqlite',
      // no sqlite section
    };

    await expect(createStorage(config)).rejects.toThrow('SQLite storage configuration section is missing');
  });
});
