/**
 * Azure Blob Storage implementation of the IConsolidationRepository interface.
 * Consolidations are stored as JSON arrays in time-bucketed blobs:
 *   {userId}/{timePeriod}/consolidations.json
 *
 * Cross-period scanning is used for operations that span all time periods.
 * ETag-based optimistic concurrency protects writes.
 */

import type { ContainerClient } from '@azure/storage-blob';
import type { ConsolidationRow, NewConsolidation } from '../types.js';
import type { IConsolidationRepository } from '../interfaces.js';
import type { TimePeriodFormat } from '../../config/types.js';
import {
  generateTimePeriodKey,
  readJsonBlob,
  readModifyWrite,
  listTimePeriodPrefixes,
} from './blob-helpers.js';

const DATA_TYPE = 'consolidations';

export class AzureBlobConsolidationRepository
  implements IConsolidationRepository
{
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
   * Returns 1 if no consolidations exist.
   */
  private async getNextId(): Promise<number> {
    const all = await this.getAll();
    if (all.length === 0) return 1;
    return Math.max(...all.map((c) => c.id)) + 1;
  }

  async insert(consolidation: NewConsolidation): Promise<ConsolidationRow> {
    const globalMax = await this.getNextId();
    const now = new Date().toISOString();
    const blobPath = this.getCurrentBlobPath();
    const client = this.containerClient.getBlockBlobClient(blobPath);

    let insertedRow: ConsolidationRow | undefined;

    await readModifyWrite<ConsolidationRow>(client, (items) => {
      const localMax = items.length > 0
        ? Math.max(...items.map((c) => c.id))
        : 0;
      const nextId = Math.max(globalMax, localMax + 1);

      const newRow: ConsolidationRow = {
        id: nextId,
        userId: consolidation.userId,
        sourceIds: consolidation.sourceIds,
        summary: consolidation.summary,
        insight: consolidation.insight,
        createdAt: now,
      };
      insertedRow = newRow;
      return [...items, newRow];
    });

    return insertedRow!;
  }

  async getAll(): Promise<ConsolidationRow[]> {
    const blobPaths = await listTimePeriodPrefixes(
      this.containerClient,
      this.userId,
      DATA_TYPE
    );
    const allConsolidations: ConsolidationRow[] = [];
    for (const blobPath of blobPaths) {
      const client = this.containerClient.getBlockBlobClient(blobPath);
      const { items } = await readJsonBlob<ConsolidationRow>(client);
      allConsolidations.push(...items);
    }
    return allConsolidations.sort((a, b) => a.id - b.id);
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
      const { items } = await readJsonBlob<ConsolidationRow>(client);
      totalDeleted += items.length;
      await client.deleteIfExists();
    }
    return totalDeleted;
  }

  async getCount(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  }
}
