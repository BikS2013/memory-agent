/**
 * Azure Blob Storage implementation of the IProcessedFileRepository interface.
 * Processed files are stored as a single JSON blob (not time-bucketed):
 *   {userId}/processed-files.json
 *
 * ETag-based optimistic concurrency protects writes.
 */

import type { ContainerClient } from '@azure/storage-blob';
import type { ProcessedFileRow } from '../types.js';
import type { IProcessedFileRepository } from '../interfaces.js';
import { readJsonBlob, readModifyWrite } from './blob-helpers.js';

export class AzureBlobProcessedFileRepository
  implements IProcessedFileRepository
{
  private readonly containerClient: ContainerClient;
  private readonly userId: string;

  constructor(containerClient: ContainerClient, userId: string) {
    this.containerClient = containerClient;
    this.userId = userId;
  }

  /**
   * Returns the blob path for processed files (single blob per user, not time-bucketed).
   */
  private getBlobPath(): string {
    return `${this.userId}/processed-files.json`;
  }

  /**
   * Finds the maximum ID across all records and returns max + 1.
   * Returns 1 if no records exist.
   */
  private async getNextId(): Promise<number> {
    const all = await this.getAll();
    if (all.length === 0) return 1;
    return Math.max(...all.map((r) => r.id)) + 1;
  }

  async isProcessed(filePath: string): Promise<boolean> {
    const client = this.containerClient.getBlockBlobClient(this.getBlobPath());
    const { items } = await readJsonBlob<ProcessedFileRow>(client);
    return items.some((r) => r.filePath === filePath);
  }

  async markProcessed(filePath: string): Promise<void> {
    const client = this.containerClient.getBlockBlobClient(this.getBlobPath());

    await readModifyWrite<ProcessedFileRow>(client, (items) => {
      // Idempotent: skip if already processed
      if (items.some((r) => r.filePath === filePath)) {
        return items;
      }
      const nextId =
        items.length === 0 ? 1 : Math.max(...items.map((r) => r.id)) + 1;
      const newRow: ProcessedFileRow = {
        id: nextId,
        filePath,
        processedAt: new Date().toISOString(),
      };
      return [...items, newRow];
    });
  }

  async getAll(): Promise<ProcessedFileRow[]> {
    const client = this.containerClient.getBlockBlobClient(this.getBlobPath());
    const { items } = await readJsonBlob<ProcessedFileRow>(client);
    return items.sort((a, b) => a.id - b.id);
  }
}
