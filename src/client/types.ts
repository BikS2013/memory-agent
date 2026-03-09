/**
 * Client SDK types for the Always-On Memory Agent.
 *
 * These types define the configuration and response shapes used by the MemoryClient.
 */

/**
 * Configuration for the MemoryClient.
 */
export interface MemoryClientConfig {
  /** Base URL of the memory agent HTTP API (e.g., "http://localhost:8888"). */
  baseUrl: string;

  /**
   * Optional request timeout in milliseconds.
   * Defaults to 30000 (30 seconds) when not provided.
   * This is a client SDK convenience default for external consumers.
   */
  timeoutMs?: number;
}

/**
 * Response returned by the ingest endpoint.
 */
export interface ClientIngestResponse {
  /** Status of the ingestion operation (e.g., "ingested"). */
  status: string;

  /** The stored memory record. */
  memory: Record<string, unknown>;
}

/**
 * Response returned by the query endpoint.
 */
export interface ClientQueryResponse {
  /** The synthesized answer to the query. */
  answer: string;

  /** IDs of source memories used to generate the answer. */
  sources: number[];

  /** Confidence level of the answer (e.g., "high", "medium", "low"). */
  confidence: string;

  /** Number of individual memories considered during query. */
  memoriesConsidered: number;

  /** Number of consolidated memories considered during query. */
  consolidationsConsidered: number;
}

/**
 * Response returned by the preferences retrieval.
 */
export interface ClientPreferencesResponse {
  /** Array of preference memories matching the requested filter. */
  preferences: Array<{
    id: number;
    summary: string;
    topics: string[];
    importance: number;
    createdAt: string;
  }>;
}

/**
 * Response returned by the status endpoint.
 */
export interface ClientStatusResponse {
  /** Current system status (e.g., "running"). */
  status: string;

  /** Total number of stored memories. */
  memories: number;

  /** Number of consolidated memory entries. */
  consolidated: number;

  /** Total number of consolidation operations performed. */
  consolidations: number;

  /** System uptime in seconds. */
  uptime: number;
}
