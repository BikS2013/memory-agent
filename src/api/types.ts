/**
 * API-related types for the HTTP layer.
 */

import type { IngestAgent } from '../agents/ingest-agent.js';
import type { ConsolidateAgent } from '../agents/consolidate-agent.js';
import type { QueryAgent } from '../agents/query-agent.js';
import type { MemoryRepository } from '../database/memory-repository.js';
import type { ConsolidationRepository } from '../database/consolidation-repository.js';

/**
 * Dependencies required by the API server and route handlers.
 */
export interface ServerDependencies {
  readonly ingestAgent: IngestAgent;
  readonly consolidateAgent: ConsolidateAgent;
  readonly queryAgent: QueryAgent;
  readonly memoryRepo: MemoryRepository;
  readonly consolidationRepo: ConsolidationRepository;
}

/**
 * Request body for POST /ingest.
 */
export interface IngestRequestBody {
  readonly text: string;
  readonly source?: string;
}

/**
 * Request body for POST /delete.
 */
export interface DeleteRequestBody {
  readonly id: number;
}
