/**
 * Structured output from the IngestAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface MemoryExtraction {
  /** 1-2 sentence summary focusing on user preferences */
  readonly summary: string;
  /** Key entities: people, products, features, settings, categories */
  readonly entities: string[];
  /** 2-4 topic tags (e.g., "ui-preferences", "workflow", "tools") */
  readonly topics: string[];
  /** Importance rating from 0.0 to 1.0 */
  readonly importance: number;
}

/**
 * A connection discovered during consolidation.
 */
export interface ConsolidationConnection {
  readonly fromId: number;
  readonly toId: number;
  readonly relationship: string;
}

/**
 * Structured output from the ConsolidateAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface ConsolidationResult {
  /** Synthesized summary of preference patterns across memories */
  readonly summary: string;
  /** One actionable insight for agents to leverage */
  readonly insight: string;
  /** Connections between memories discovered during consolidation */
  readonly connections: ConsolidationConnection[];
}

/**
 * Structured output from the QueryAgent's LLM call.
 * Validated at runtime by the corresponding Zod schema.
 */
export interface QueryResult {
  /** Synthesized answer based on stored memories */
  readonly answer: string;
  /** IDs of memories referenced in the answer */
  readonly sourceMemoryIds: number[];
  /** Confidence level: "high", "medium", "low" */
  readonly confidence: 'high' | 'medium' | 'low';
}
