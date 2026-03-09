/**
 * FileWatcher - Monitors a directory for new files and triggers ingestion.
 * Uses chokidar to watch for 'add' events, deduplicates via ProcessedFileRepository,
 * and delegates content extraction to IngestAgent.
 *
 * Individual file processing errors are logged but do NOT stop the watcher.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import type { IngestAgent } from '../agents/ingest-agent.js';
import type { ProcessedFileRepository } from '../database/processed-file-repository.js';
import { SUPPORTED_EXTENSIONS } from './types.js';

export class FileWatcher {
  private readonly watchDirectory: string;
  private readonly ingestAgent: IngestAgent;
  private readonly processedFileRepo: ProcessedFileRepository;
  private watcher: FSWatcher | null = null;

  constructor(
    watchDirectory: string,
    ingestAgent: IngestAgent,
    processedFileRepo: ProcessedFileRepository,
  ) {
    this.watchDirectory = watchDirectory;
    this.ingestAgent = ingestAgent;
    this.processedFileRepo = processedFileRepo;
  }

  /**
   * Creates the watch directory if it doesn't exist and starts
   * watching for new files via chokidar.
   * Uses ignoreInitial: false to pick up existing files on startup.
   */
  start(): void {
    fs.mkdirSync(this.watchDirectory, { recursive: true });

    this.watcher = chokidar.watch(this.watchDirectory, {
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher.on('add', async (filePath: string) => {
      try {
        await this.processFile(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[FileWatcher] Error processing file ${filePath}: ${message}`);
      }
    });
  }

  /**
   * Stops the chokidar watcher.
   * Chokidar v4 close() returns a Promise, so this is async.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Processes a single file:
   * 1. Checks if the extension is supported (case-insensitive)
   * 2. Checks if already processed via ProcessedFileRepository
   * 3. Reads file content
   * 4. Calls IngestAgent.ingest()
   * 5. Marks the file as processed
   */
  private async processFile(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.includes(ext as typeof SUPPORTED_EXTENSIONS[number])) {
      console.log(`[FileWatcher] Skipping unsupported file type: ${filePath}`);
      return;
    }

    if (this.processedFileRepo.isProcessed(filePath)) {
      console.log(`[FileWatcher] Already processed, skipping: ${filePath}`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    await this.ingestAgent.ingest(content, filePath);

    this.processedFileRepo.markProcessed(filePath);

    console.log(`[FileWatcher] Successfully processed: ${filePath}`);
  }
}
