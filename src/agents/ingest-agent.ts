/**
 * IngestAgent - Extracts structured metadata from raw text via LLM
 * and persists it as a memory in the database.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemoryExtractionSchema } from '../llm/schemas.js';
import { INGEST_SYSTEM_PROMPT } from '../llm/prompts.js';
import type { IMemoryRepository } from '../database/interfaces.js';
import type { MemoryRow } from '../database/types.js';
import type { MemoryExtraction } from '../llm/types.js';

export class IngestAgent {
  private readonly llm: BaseChatModel;
  private readonly memoryRepo: IMemoryRepository;

  constructor(llm: BaseChatModel, memoryRepo: IMemoryRepository) {
    this.llm = llm;
    this.memoryRepo = memoryRepo;
  }

  /**
   * Ingests raw text by extracting structured metadata via the LLM
   * and storing it as a new memory.
   *
   * @param text - The raw text to ingest
   * @param source - The source of the text (e.g., "file-watcher", "api", "agent-ui")
   * @param userId - Optional user identifier, defaults to 'default'
   * @returns The inserted MemoryRow
   */
  async ingest(text: string, source: string, userId?: string): Promise<MemoryRow> {
    const resolvedUserId = userId ?? 'default';

    let extraction: MemoryExtraction;
    try {
      const structuredLlm = this.llm.withStructuredOutput(MemoryExtractionSchema);
      const response = await structuredLlm.invoke([
        new SystemMessage(INGEST_SYSTEM_PROMPT),
        new HumanMessage(text),
      ]);
      extraction = response as MemoryExtraction;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`IngestAgent LLM extraction failed: ${message}`);
    }

    const newMemory = {
      userId: resolvedUserId,
      source,
      rawText: text,
      summary: extraction.summary,
      entities: JSON.stringify(extraction.entities),
      topics: JSON.stringify(extraction.topics),
      importance: extraction.importance,
    };

    return await this.memoryRepo.insert(newMemory);
  }
}
