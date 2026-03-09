export type {
  MemoryExtraction,
  ConsolidationConnection,
  ConsolidationResult,
  QueryResult,
} from './types.js';

export {
  MemoryExtractionSchema,
  ConsolidationResultSchema,
  QueryResultSchema,
} from './schemas.js';

export { createLlm } from './provider-factory.js';

export {
  INGEST_SYSTEM_PROMPT,
  CONSOLIDATE_SYSTEM_PROMPT,
  QUERY_SYSTEM_PROMPT,
} from './prompts.js';
