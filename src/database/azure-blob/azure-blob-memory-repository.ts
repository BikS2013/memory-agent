/**
 * Azure Blob Storage implementation of the IMemoryRepository interface.
 * Memories are stored as JSON arrays in time-bucketed blobs:
 *   {userId}/{timePeriod}/memories.json
 *
 * Cross-period scanning is used for operations that span all time periods.
 * ETag-based optimistic concurrency protects writes.
 */

import type { ContainerClient } from '@azure/storage-blob';
import type {
  MemoryRow,
  NewMemory,
  ConnectionEntry,
  MemoryStats,
} from '../types.js';
import type { IMemoryRepository } from '../interfaces.js';
import type { TimePeriodFormat } from '../../config/types.js';
import {
  generateTimePeriodKey,
  readJsonBlob,
  readModifyWrite,
  listTimePeriodPrefixes,
} from './blob-helpers.js';

const DATA_TYPE = 'memories';

export class AzureBlobMemoryRepository implements IMemoryRepository {
  private readonly containerClient: ContainerClient;
  private readonly userId: string;
  private readonly timePeriodFormat: TimePeriodFormat;

  constructor(
    containerClient: ContainerClient,
    userId: string,
    timePeriodFormat: TimePeriodFormat
  ) {
    this.containerClient = containerClient;
    this.userId = userId;
    this.timePeriodFormat = timePeriodFormat;
  }

  /**
   * Returns the blob path for the current time period.
   */
  private getCurrentBlobPath(): string {
    const period = generateTimePeriodKey(new Date(), this.timePeriodFormat);
    return `${this.userId}/${period}/${DATA_TYPE}.json`;
  }

  /**
   * Finds the maximum ID across all time period blobs and returns max + 1.
   * Returns 1 if no memories exist.
   */
  private async getNextId(): Promise<number> {
    const allMemories = await this.getAll();
    if (allMemories.length === 0) return 1;
    return Math.max(...allMemories.map((m) => m.id)) + 1;
  }

  async insert(memory: NewMemory): Promise<MemoryRow> {
    // Compute the global max ID across all periods first.
    // The ID is then validated/used inside the readModifyWrite callback
    // to ensure atomicity within the target blob.
    const globalMax = await this.getNextId();
    const now = new Date().toISOString();
    const blobPath = this.getCurrentBlobPath();
    const client = this.containerClient.getBlockBlobClient(blobPath);

    let insertedRow: MemoryRow | undefined;

    await readModifyWrite<MemoryRow>(client, (items) => {
      // Re-derive max ID from blob-local items combined with the global max
      // to handle concurrent inserts into the same blob.
      const localMax = items.length > 0
        ? Math.max(...items.map((m) => m.id))
        : 0;
      const nextId = Math.max(globalMax, localMax + 1);

      const newRow: MemoryRow = {
        id: nextId,
        userId: memory.userId ?? 'default',
        source: memory.source,
        rawText: memory.rawText,
        summary: memory.summary,
        entities: memory.entities,
        topics: memory.topics,
        importance: memory.importance,
        consolidated: 0,
        connections: '[]',
        createdAt: now,
      };
      insertedRow = newRow;
      return [...items, newRow];
    });

    return insertedRow!;
  }

  async getAll(): Promise<MemoryRow[]> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    const allMemories: MemoryRow[] = [];
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      const { items } = await readJsonBlob<MemoryRow>(client);
      allMemories.push(...items);
    }
    return allMemories.sort((a, b) => a.id - b.id);
  }

  async getById(id: number): Promise<MemoryRow | undefined> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      const { items } = await readJsonBlob<MemoryRow>(client);
      const found = items.find((m) => m.id === id);
      if (found) return found;
    }
    return undefined;
  }

  async getUnconsolidated(): Promise<MemoryRow[]> {
    const all = await this.getAll();
    return all.filter((m) => m.consolidated === 0);
  }

  async markConsolidated(ids: number[]): Promise<void> {
    const idSet = new Set(ids);
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      await readModifyWrite<MemoryRow>(client, (memories) =>
        memories.map((m) =>
          idSet.has(m.id) ? { ...m, consolidated: 1 } : m
        )
      );
    }
  }

  async updateConnections(
    id: number,
    connections: ConnectionEntry[]
  ): Promise<void> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      let found = false;
      await readModifyWrite<MemoryRow>(client, (memories) => {
        if (memories.some((m) => m.id === id)) {
          found = true;
          return memories.map((m) =>
            m.id === id ? { ...m, connections: JSON.stringify(connections) } : m
          );
        }
        return memories;
      });
      if (found) return;
    }
  }

  async deleteById(id: number): Promise<boolean> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      let found = false;
      await readModifyWrite<MemoryRow>(client, (memories) => {
        if (memories.some((m) => m.id === id)) {
          found = true;
          return memories.filter((m) => m.id !== id);
        }
        return memories;
      });
      if (found) return true;
    }
    return false;
  }

  async deleteAll(): Promise<number> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    let totalDeleted = 0;
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      const { items } = await readJsonBlob<MemoryRow>(client);
      totalDeleted += items.length;
      await client.deleteIfExists();
    }
    return totalDeleted;
  }

  async getStats(): Promise<MemoryStats> {
    const all = await this.getAll();
    const total = all.length;
    const consolidated = all.filter((m) => m.consolidated === 1).length;

    // Count consolidations from the consolidation blobs
    const consolidationPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      'consolidations'
    );
    let consolidationsCount = 0;
    for (const blobPath of consolidationPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      const { items } = await readJsonBlob<unknown>(client);
      consolidationsCount += items.length;
    }

    return {
      total,
      consolidated,
      unconsolidated: total - consolidated,
      consolidations: consolidationsCount,
    };
  }
}
