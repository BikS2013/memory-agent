/**
 * Factory function that creates a complete Azure Blob Storage bundle.
 * Returns all three repositories and a close() handle (no-op for blob storage).
 */

import type { AzureBlobConfig } from '../../config/types.js';
import type { StorageBundle } from '../interfaces.js';
import { createContainerClient } from './blob-helpers.js';
import { AzureBlobMemoryRepository } from './azure-blob-memory-repository.js';
import { AzureBlobConsolidationRepository } from './azure-blob-consolidation-repository.js';
import { AzureBlobProcessedFileRepository } from './azure-blob-processed-file-repository.js';

/**
 * Creates an Azure Blob Storage-backed StorageBundle from the given configuration.
 *
 * @param config - Azure Blob configuration containing auth method, container name, and time period format.
 * @param userId - User identifier for blob path prefixing. Defaults to 'default'.
 * @returns A StorageBundle with all repositories and a no-op close() method.
 */
export async function createAzureBlobStorage(
  config: AzureBlobConfig,
  userId?: string
): Promise<StorageBundle> {
  const resolvedUserId = userId ?? 'default';
  const containerClient = createContainerClient(config);

  // Ensure the container exists
  await containerClient.createIfNotExists();

  const memoryRepo = new AzureBlobMemoryRepository(
    containerClient,
    resolvedUserId,
    config.timePeriodFormat
  );
  const consolidationRepo = new AzureBlobConsolidationRepository(
    containerClient,
    resolvedUserId,
    config.timePeriodFormat
  );
  const processedFileRepo = new AzureBlobProcessedFileRepository(
    containerClient,
    resolvedUserId
  );

  return {
    memoryRepo,
    consolidationRepo,
    processedFileRepo,
    async close(): Promise<void> {
      /* No-op: Azure Blob is HTTP-based, no persistent connection to close */
    },
  };
}
