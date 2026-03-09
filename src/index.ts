import { loadConfig } from './config/index.js';
import {
  initializeDatabase,
  closeDatabase,
  MemoryRepository,
  ConsolidationRepository,
  ProcessedFileRepository,
} from './database/index.js';
import { createLlm } from './llm/index.js';
import { IngestAgent, ConsolidateAgent, QueryAgent } from './agents/index.js';
import { createServer, startServer, stopServer } from './api/index.js';
import { FileWatcher } from './watcher/index.js';
import { ConsolidationLoop } from './consolidation/index.js';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

async function main(): Promise<void> {
  // Step 1: Load configuration (throws on missing/invalid)
  const config = loadConfig();
  console.log('Configuration loaded successfully');

  // Step 2: Initialize database
  const db: Database.Database = initializeDatabase(config.databasePath);
  const memoryRepo = new MemoryRepository(db);
  const consolidationRepo = new ConsolidationRepository(db);
  const processedFileRepo = new ProcessedFileRepository(db);
  console.log(`Database initialized: ${config.databasePath}`);

  // Step 3: Create LLM instance
  const llm = createLlm(config);
  console.log(`LLM configured: ${config.llmProvider}/${config.llmModel}`);

  // Step 4: Create agents
  const ingestAgent = new IngestAgent(llm, memoryRepo);
  const consolidateAgent = new ConsolidateAgent(llm, memoryRepo, consolidationRepo);
  const queryAgent = new QueryAgent(llm, memoryRepo, consolidationRepo);

  // Step 5: Start HTTP server
  const server: FastifyInstance = createServer({
    ingestAgent,
    consolidateAgent,
    queryAgent,
    memoryRepo,
    consolidationRepo,
  });
  await startServer(server, config.apiPort);
  console.log(`HTTP API listening on http://localhost:${config.apiPort}`);

  // Step 6: Start file watcher
  const fileWatcher = new FileWatcher(config.watchDirectory, ingestAgent, processedFileRepo);
  fileWatcher.start();
  console.log(`Watching directory: ${config.watchDirectory}`);

  // Step 7: Start consolidation loop
  const consolidationLoop = new ConsolidationLoop(consolidateAgent, config.consolidationIntervalMs);
  consolidationLoop.start();
  console.log(`Consolidation loop: every ${config.consolidationIntervalMs}ms`);

  // Step 8: Log ready
  console.log('');
  console.log('Always-On Memory Agent started successfully');
  console.log(`  HTTP API:       http://localhost:${config.apiPort}`);
  console.log(`  Watching:       ${config.watchDirectory}`);
  console.log(`  Database:       ${config.databasePath}`);
  console.log(`  LLM:            ${config.llmProvider}/${config.llmModel}`);
  console.log(`  Consolidation:  every ${config.consolidationIntervalMs}ms`);

  // Step 9: Register signal handlers
  const gracefulShutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down...`);

    consolidationLoop.stop();
    console.log('Consolidation loop stopped');

    await fileWatcher.stop();
    console.log('File watcher stopped');

    await stopServer(server);
    console.log('HTTP server stopped');

    closeDatabase(db);
    console.log('Database connection closed');

    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });
}

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});
