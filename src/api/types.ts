/**
 * API-related types for the HTTP layer.
 */

import type { IngestAgent } from '../agents/ingest-agent.js';
import type { ConsolidateAgent } from '../agents/consolidate-agent.js';
import type { QueryAgent } from '../agents/query-agent.js';
import type { IMemoryRepository, IConsolidationRepository } from '../database/interfaces.js';

/**
 * Dependencies required by the API server and route handlers.
 */
export interface ServerDependencies {
  readonly ingestAgent: IngestAgent;
  readonly consolidateAgent: ConsolidateAgent;
  readonly queryAgent: QueryAgent;
  readonly memoryRepo: IMemoryRepository;
  readonly consolidationRepo: IConsolidationRepository;
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
