/**
 * Agent unit tests with mocked LLM.
 * Tests IngestAgent, ConsolidateAgent, and QueryAgent behavior
 * using a fake LLM that returns predictable structured output.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { IngestAgent } from '../src/agents/ingest-agent.js';
import { ConsolidateAgent } from '../src/agents/consolidate-agent.js';
import { QueryAgent } from '../src/agents/query-agent.js';
import { SqliteMemoryRepository } from '../src/database/sqlite/sqlite-memory-repository.js';
import { SqliteConsolidationRepository } from '../src/database/sqlite/sqlite-consolidation-repository.js';
import { ALL_SCHEMA_STATEMENTS } from '../src/database/schema.js';
import type { MemoryExtraction } from '../src/llm/types.js';
import type { ConsolidationResult } from '../src/llm/types.js';
import type { QueryResult } from '../src/llm/types.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

// --- Mock LLM factory ---

/**
 * Creates a mock LLM that returns the given structured output
 * when withStructuredOutput().invoke() is called.
 */
function createMockLlm(structuredResponse: unknown): BaseChatModel {
  return {
    withStructuredOutput: () => ({
      invoke: async () => structuredResponse,
    }),
  } as unknown as BaseChatModel;
}

// --- Fake LLM responses ---

const fakeMemoryExtraction: MemoryExtraction = {
  summary: 'User prefers dark mode in all applications',
  entities: ['dark mode', 'applications'],
  topics: ['ui-preferences'],
  importance: 0.8,
};

const fakeConsolidationResult: ConsolidationResult = {
  summary: 'User consistently prefers dark themes and minimal UI',
  insight: 'Apply dark mode by default and minimize visual clutter',
  connections: [
    { fromId: 1, toId: 2, relationship: 'complementary' },
  ],
};

const fakeQueryResult: QueryResult = {
  answer: 'The user prefers dark mode [Memory 1] and minimal UI [Memory 2].',
  sourceMemoryIds: [1, 2],
  confidence: 'high',
};

// --- Test suites ---

describe('IngestAgent', () => {
  let db: Database.Database;
  let memoryRepo: SqliteMemoryRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const stmt of ALL_SCHEMA_STATEMENTS) {
      db.exec(stmt);
    }
    memoryRepo = new SqliteMemoryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('ingest() calls LLM and stores memory in database', async () => {
    const mockLlm = createMockLlm(fakeMemoryExtraction);
    const agent = new IngestAgent(mockLlm, memoryRepo);

    const result = await agent.ingest('I prefer dark mode everywhere', 'api');

    expect(result.id).toBe(1);
    expect(result.source).toBe('api');
    expect(result.rawText).toBe('I prefer dark mode everywhere');
    expect(result.summary).toBe(fakeMemoryExtraction.summary);
    expect(result.importance).toBe(fakeMemoryExtraction.importance);
    expect(result.consolidated).toBe(0);
    expect(result.userId).toBe('default');

    // Verify it was persisted
    const allMemories = await memoryRepo.getAll();
    expect(allMemories).toHaveLength(1);
    expect(allMemories[0]!.id).toBe(1);
  });

  it('ingest() uses provided userId', async () => {
    const mockLlm = createMockLlm(fakeMemoryExtraction);
    const agent = new IngestAgent(mockLlm, memoryRepo);

    const result = await agent.ingest('test', 'api', 'user-42');

    expect(result.userId).toBe('user-42');
  });

  it('ingest() throws on LLM failure', async () => {
    const failingLlm = {
      withStructuredOutput: () => ({
        invoke: async () => { throw new Error('LLM unavailable'); },
      }),
    } as unknown as BaseChatModel;

    const agent = new IngestAgent(failingLlm, memoryRepo);

    await expect(agent.ingest('test', 'api')).rejects.toThrow('IngestAgent LLM extraction failed');
  });
});

describe('ConsolidateAgent', () => {
  let db: Database.Database;
  let memoryRepo: SqliteMemoryRepository;
  let consolidationRepo: SqliteConsolidationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const stmt of ALL_SCHEMA_STATEMENTS) {
      db.exec(stmt);
    }
    memoryRepo = new SqliteMemoryRepository(db);
    consolidationRepo = new SqliteConsolidationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('consolidate() skips when fewer than 2 unconsolidated memories', async () => {
    const mockLlm = createMockLlm(fakeConsolidationResult);
    const agent = new ConsolidateAgent(mockLlm, memoryRepo, consolidationRepo);

    // No memories at all
    const result0 = await agent.consolidate();
    expect(result0.consolidated).toBe(false);
    expect(result0.memoriesProcessed).toBe(0);
    expect(result0.consolidation).toBeNull();

    // Only 1 memory
    await memoryRepo.insert({
      source: 'api',
      rawText: 'test',
      summary: 'test summary',
      entities: '[]',
      topics: '[]',
      importance: 0.5,
    });

    const result1 = await agent.consolidate();
    expect(result1.consolidated).toBe(false);
    expect(result1.memoriesProcessed).toBe(0);
    expect(result1.consolidation).toBeNull();
  });

  it('consolidate() processes when 2+ unconsolidated memories', async () => {
    const mockLlm = createMockLlm(fakeConsolidationResult);
    const agent = new ConsolidateAgent(mockLlm, memoryRepo, consolidationRepo);

    // Insert 2 memories
    await memoryRepo.insert({
      source: 'api',
      rawText: 'I prefer dark mode',
      summary: 'User prefers dark mode',
      entities: '["dark mode"]',
      topics: '["ui-preferences"]',
      importance: 0.8,
    });
    await memoryRepo.insert({
      source: 'api',
      rawText: 'I like minimal UI',
      summary: 'User likes minimal UI',
      entities: '["minimal UI"]',
      topics: '["ui-preferences"]',
      importance: 0.7,
    });

    const result = await agent.consolidate();

    expect(result.consolidated).toBe(true);
    expect(result.memoriesProcessed).toBe(2);
    expect(result.consolidation).not.toBeNull();
    expect(result.consolidation!.summary).toBe(fakeConsolidationResult.summary);
    expect(result.consolidation!.insight).toBe(fakeConsolidationResult.insight);

    // Verify memories are now marked consolidated
    const unconsolidated = await memoryRepo.getUnconsolidated();
    expect(unconsolidated).toHaveLength(0);

    // Verify consolidation was persisted
    const allConsolidations = await consolidationRepo.getAll();
    expect(allConsolidations).toHaveLength(1);
  });

  it('consolidate() throws on LLM failure', async () => {
    const failingLlm = {
      withStructuredOutput: () => ({
        invoke: async () => { throw new Error('LLM unavailable'); },
      }),
    } as unknown as BaseChatModel;

    const agent = new ConsolidateAgent(failingLlm, memoryRepo, consolidationRepo);

    // Need 2+ memories to trigger LLM call
    await memoryRepo.insert({
      source: 'api',
      rawText: 'test1',
      summary: 'summary1',
      entities: '[]',
      topics: '[]',
      importance: 0.5,
    });
    await memoryRepo.insert({
      source: 'api',
      rawText: 'test2',
      summary: 'summary2',
      entities: '[]',
      topics: '[]',
      importance: 0.5,
    });

    await expect(agent.consolidate()).rejects.toThrow('ConsolidateAgent LLM consolidation failed');
  });
});

describe('QueryAgent', () => {
  let db: Database.Database;
  let memoryRepo: SqliteMemoryRepository;
  let consolidationRepo: SqliteConsolidationRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const stmt of ALL_SCHEMA_STATEMENTS) {
      db.exec(stmt);
    }
    memoryRepo = new SqliteMemoryRepository(db);
    consolidationRepo = new SqliteConsolidationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('query() returns synthesized answer from LLM', async () => {
    const mockLlm = createMockLlm(fakeQueryResult);
    const agent = new QueryAgent(mockLlm, memoryRepo, consolidationRepo);

    // Insert a memory so context is non-empty
    await memoryRepo.insert({
      source: 'api',
      rawText: 'I prefer dark mode',
      summary: 'User prefers dark mode',
      entities: '["dark mode"]',
      topics: '["ui-preferences"]',
      importance: 0.8,
    });

    const result = await agent.query('What are the UI preferences?');

    expect(result.answer).toBe(fakeQueryResult.answer);
    expect(result.sources).toEqual(fakeQueryResult.sourceMemoryIds);
    expect(result.confidence).toBe('high');
    expect(result.memoriesConsidered).toBe(1);
    expect(result.consolidationsConsidered).toBe(0);
  });

  it('query() works with no memories', async () => {
    const mockLlm = createMockLlm(fakeQueryResult);
    const agent = new QueryAgent(mockLlm, memoryRepo, consolidationRepo);

    const result = await agent.query('What preferences exist?');

    expect(result.answer).toBe(fakeQueryResult.answer);
    expect(result.memoriesConsidered).toBe(0);
    expect(result.consolidationsConsidered).toBe(0);
  });

  it('query() throws on LLM failure', async () => {
    const failingLlm = {
      withStructuredOutput: () => ({
        invoke: async () => { throw new Error('LLM unavailable'); },
      }),
    } as unknown as BaseChatModel;

    const agent = new QueryAgent(failingLlm, memoryRepo, consolidationRepo);

    await expect(agent.query('test')).rejects.toThrow('QueryAgent LLM query failed');
  });
});
