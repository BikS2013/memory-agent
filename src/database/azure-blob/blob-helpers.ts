/**
 * Utility functions for Azure Blob Storage operations.
 * Handles JSON blob read/write, ETag-based concurrency, time period keys,
 * and cross-period prefix listing.
 */

import {
  BlobServiceClient,
  type ContainerClient,
  type BlockBlobClient,
  type BlobDownloadResponseParsed,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { AzureBlobConfig } from '../../config/types.js';

const MAX_RETRIES = 3;

export interface BlobReadResult<T> {
  items: T[];
  etag: string | undefined;
}

/**
 * Creates a ContainerClient from the Azure Blob configuration.
 * Uses connection string or DefaultAzureCredential based on authMethod.
 */
export function createContainerClient(config: AzureBlobConfig): ContainerClient {
  let blobServiceClient: BlobServiceClient;

  switch (config.authMethod) {
    case 'connection-string': {
      blobServiceClient = BlobServiceClient.fromConnectionString(
        config.connectionString!
      );
      break;
    }
    case 'azure-identity': {
      const credential = new DefaultAzureCredential();
      const accountUrl = `https://${config.accountName!}.blob.core.windows.net`;
      blobServiceClient = new BlobServiceClient(accountUrl, credential);
      break;
    }
    default: {
      const _exhaustive: never = config.authMethod;
      throw new Error(`Unsupported auth method: ${config.authMethod}`);
    }
  }

  return blobServiceClient.getContainerClient(config.containerName);
}

/**
 * Generates the time-period key for a given date.
 *
 * @param date - The date to generate the key for.
 * @param format - 'monthly' => '2026-03', 'weekly' => '2026-W10', 'daily' => '2026-03-09'
 */
export function generateTimePeriodKey(
  date: Date,
  format: 'monthly' | 'weekly' | 'daily'
): string {
  switch (format) {
    case 'monthly':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    case 'weekly': {
      const weekNumber = getISOWeekNumber(date);
      return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    }
    case 'daily':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported time period format: ${format}`);
    }
  }
}

/**
 * Reads a JSON blob. Returns empty array with undefined etag if the blob does not exist (404).
 */
export async function readJsonBlob<T>(
  blockBlobClient: BlockBlobClient
): Promise<BlobReadResult<T>> {
  try {
    const response: BlobDownloadResponseParsed =
      await blockBlobClient.download(0);
    const body = await streamToString(response.readableStreamBody!);
    const items = JSON.parse(body) as T[];
    return { items, etag: response.etag };
  } catch (error: unknown) {
    if (isBlobNotFoundError(error)) {
      return { items: [], etag: undefined };
    }
    throw error;
  }
}

/**
 * Writes a JSON blob with optional ETag condition for optimistic concurrency.
 */
export async function writeJsonBlob<T>(
  blockBlobClient: BlockBlobClient,
  items: T[],
  etag?: string
): Promise<void> {
  const content = JSON.stringify(items, null, 2);
  // If we have an ETag from a previous read, enforce it hasn't changed (optimistic concurrency).
  // If no ETag (blob didn't exist), use ifNoneMatch:"*" to ensure we don't overwrite a
  // concurrently-created blob.
  const conditions = etag
    ? { ifMatch: etag }
    : { ifNoneMatch: '*' };
  await blockBlobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    conditions,
  });
}

/**
 * Atomic read-modify-write with ETag-based optimistic concurrency.
 * Retries up to MAX_RETRIES times on ETag mismatch (HTTP 412).
 */
export async function readModifyWrite<T>(
  blockBlobClient: BlockBlobClient,
  modifier: (items: T[]) => T[]
): Promise<T[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { items, etag } = await readJsonBlob<T>(blockBlobClient);
    const modified = modifier(items);
    try {
      await writeJsonBlob(blockBlobClient, modified, etag);
      return modified;
    } catch (error: unknown) {
      if (isEtagMismatchError(error) && attempt < MAX_RETRIES - 1) {
        continue; // Retry with fresh read
      }
      throw error;
    }
  }
  throw new Error(
    `readModifyWrite failed after ${MAX_RETRIES} retries due to concurrent modifications`
  );
}

/**
 * Lists all blob paths matching {userId}/*\/{dataType}.json for cross-period scanning.
 */
export async function listTimePeriodPrefixes(
  containerClient: ContainerClient,
  userId: string,
  dataType: string
): Promise<string[]> {
  const prefixes: string[] = [];
  const prefix = `${userId}/`;
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith(`/${dataType}.json`)) {
      prefixes.push(blob.name);
    }
  }
  return prefixes;
}

function isBlobNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: number }).statusCode === 404
  );
}

function isEtagMismatchError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: number }).statusCode === 412
  );
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

async function streamToString(
  stream: NodeJS.ReadableStream
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
