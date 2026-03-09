/**
 * Barrel exports for the Azure Blob Storage backend.
 */

export {
  createContainerClient,
  generateTimePeriodKey,
  readJsonBlob,
  writeJsonBlob,
  readModifyWrite,
  listTimePeriodPrefixes,
  type BlobReadResult,
} from './blob-helpers.js';

export { AzureBlobMemoryRepository } from './azure-blob-memory-repository.js';
export { AzureBlobConsolidationRepository } from './azure-blob-consolidation-repository.js';
export { AzureBlobProcessedFileRepository } from './azure-blob-processed-file-repository.js';
export { createAzureBlobStorage } from './create-azure-blob-storage.js';
