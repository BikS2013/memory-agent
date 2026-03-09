/**
 * ConsolidateAgent - Analyzes unconsolidated memories to find cross-cutting
 * patterns, generates insights, and identifies connections between memories.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ConsolidationResultSchema } from '../llm/schemas.js';
import { CONSOLIDATE_SYSTEM_PROMPT } from '../llm/prompts.js';
import type { MemoryRepository } from '../database/memory-repository.js';
import type { ConsolidationRepository } from '../database/consolidation-repository.js';
import type { ConsolidationRow, MemoryRow } from '../database/types.js';
import type { ConsolidationResult } from '../llm/types.js';

export interface ConsolidateResult {
  readonly consolidated: boolean;
  readonly memoriesProcessed: number;
  readonly consolidation: ConsolidationRow | null;
}

export class ConsolidateAgent {
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
   * Consolidates unconsolidated memories by finding patterns and connections.
   * Requires at least 2 unconsolidated memories to proceed.
   *
   * @param userId - Optional user identifier, defaults to 'default'
   * @returns Consolidation result with status, count, and the consolidation row (if created)
   */
  async consolidate(userId?: string): Promise<ConsolidateResult> {
    const resolvedUserId = userId ?? 'default';

    const unconsolidated = this.memoryRepo.getUnconsolidated();

    if (unconsolidated.length < 2) {
      return { consolidated: false, memoriesProcessed: 0, consolidation: null };
    }

    const formattedMemories = this.formatMemoriesForLlm(unconsolidated);

    let result: ConsolidationResult;
    try {
      const structuredLlm = this.llm.withStructuredOutput(ConsolidationResultSchema);
      const response = await structuredLlm.invoke([
        new SystemMessage(CONSOLIDATE_SYSTEM_PROMPT),
        new HumanMessage(formattedMemories),
      ]);
      result = response as ConsolidationResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ConsolidateAgent LLM consolidation failed: ${message}`);
    }

    const memoryIds = unconsolidated.map((m) => m.id);

    const consolidation = this.consolidationRepo.insert({
      userId: resolvedUserId,
      sourceIds: JSON.stringify(memoryIds),
      summary: result.summary,
      insight: result.insight,
    });

    this.memoryRepo.markConsolidated(memoryIds);

    return {
      consolidated: true,
      memoriesProcessed: unconsolidated.length,
      consolidation,
    };
  }

  /**
   * Formats memory rows into a text block for the LLM to analyze.
   */
  private formatMemoriesForLlm(memories: MemoryRow[]): string {
    const lines = memories.map((m) => {
      const entities = m.entities;
      const topics = m.topics;
      return [
        `--- Memory ID: ${m.id} ---`,
        `Summary: ${m.summary}`,
        `Entities: ${entities}`,
        `Topics: ${topics}`,
        `Importance: ${m.importance}`,
        `Source: ${m.source}`,
        `Created: ${m.createdAt}`,
        '',
      ].join('\n');
    });

    return `The following ${memories.length} memories need consolidation:\n\n${lines.join('\n')}`;
  }
}
