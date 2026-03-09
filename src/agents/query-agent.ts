/**
 * QueryAgent - Answers natural language questions about stored user preferences
 * by synthesizing information from memories and consolidations.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { QueryResultSchema } from '../llm/schemas.js';
import { QUERY_SYSTEM_PROMPT } from '../llm/prompts.js';
import type { MemoryRepository } from '../database/memory-repository.js';
import type { ConsolidationRepository } from '../database/consolidation-repository.js';
import type { MemoryRow, ConsolidationRow } from '../database/types.js';
import type { QueryResult } from '../llm/types.js';

export interface QueryResponse {
  readonly answer: string;
  readonly sources: number[];
  readonly confidence: string;
  readonly memoriesConsidered: number;
  readonly consolidationsConsidered: number;
}

export class QueryAgent {
  private readonly llm: BaseChatModel;
  private readonly memoryRepo: MemoryRepository;
  private readonly consolidationRepo: ConsolidationRepository;

  constructor(
    llm: BaseChatModel,
    memoryRepo: MemoryRepository,
    consolidationRepo: ConsolidationRepository
  ) {
    this.llm = llm;
    this.memoryRepo = memoryRepo;
    this.consolidationRepo = consolidationRepo;
  }

  /**
   * Answers a natural language question using stored memories and consolidations.
   *
   * @param question - The natural language question to answer
   * @param userId - Optional user identifier, defaults to 'default'
   * @returns A structured response with the answer, sources, confidence, and context counts
   */
  async query(question: string, _userId?: string): Promise<QueryResponse> {
    // _userId reserved for future multi-tenant filtering
    const memories = this.memoryRepo.getAll();
    const consolidations = this.consolidationRepo.getAll();

    const context = this.formatContext(memories, consolidations);

    let result: QueryResult;
    try {
      const structuredLlm = this.llm.withStructuredOutput(QueryResultSchema);
      const response = await structuredLlm.invoke([
        new SystemMessage(QUERY_SYSTEM_PROMPT),
        new HumanMessage(`${context}\n\nQuestion: ${question}`),
      ]);
      result = response as QueryResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`QueryAgent LLM query failed: ${message}`);
    }

    return {
      answer: result.answer,
      sources: result.sourceMemoryIds,
      confidence: result.confidence,
      memoriesConsidered: memories.length,
      consolidationsConsidered: consolidations.length,
    };
  }

  /**
   * Formats memories and consolidations into a context text block for the LLM.
   */
  private formatContext(memories: MemoryRow[], consolidations: ConsolidationRow[]): string {
    const memorySection =
      memories.length > 0
        ? memories
            .map((m) =>
              [
                `--- Memory ID: ${m.id} ---`,
                `Summary: ${m.summary}`,
                `Entities: ${m.entities}`,
                `Topics: ${m.topics}`,
                `Importance: ${m.importance}`,
                `Source: ${m.source}`,
                `Created: ${m.createdAt}`,
                '',
              ].join('\n')
            )
            .join('\n')
        : 'No memories stored yet.';

    const consolidationSection =
      consolidations.length > 0
        ? consolidations
            .map((c) =>
              [
                `--- Consolidation ID: ${c.id} ---`,
                `Summary: ${c.summary}`,
                `Insight: ${c.insight}`,
                `Source Memory IDs: ${c.sourceIds}`,
                `Created: ${c.createdAt}`,
                '',
              ].join('\n')
            )
            .join('\n')
        : 'No consolidations available yet.';

    return `=== STORED MEMORIES ===\n\n${memorySection}\n\n=== CONSOLIDATION INSIGHTS ===\n\n${consolidationSection}`;
  }
}
