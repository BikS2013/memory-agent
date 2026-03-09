/**
 * HTTP API integration tests for the Always-On Memory Agent.
 * Uses Fastify inject() to test routes without starting a real server.
 * Agents are mocked to return predictable data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { registerRoutes } from '../src/api/routes.js';
import { SqliteMemoryRepository } from '../src/database/sqlite/sqlite-memory-repository.js';
import { SqliteConsolidationRepository } from '../src/database/sqlite/sqlite-consolidation-repository.js';
import { ALL_SCHEMA_STATEMENTS } from '../src/database/schema.js';
import type { ServerDependencies } from '../src/api/types.js';
import type { MemoryRow } from '../src/database/types.js';
import type { IngestAgent } from '../src/agents/ingest-agent.js';
import type { ConsolidateAgent, ConsolidateResult } from '../src/agents/consolidate-agent.js';
import type { QueryAgent, QueryResponse } from '../src/agents/query-agent.js';

// --- Fake data ---

const fakeMemoryRow: MemoryRow = {
  id: 1,
  userId: 'default',
  source: 'api',
  rawText: 'I prefer dark mode',
  summary: 'User prefers dark mode',
  entities: '["dark mode"]',
  topics: '["ui-preferences"]',
  importance: 0.8,
  consolidated: 0,
  connections: '[]',
  createdAt: '2026-03-09T00:00:00.000Z',
};

const fakeConsolidateSkipped: ConsolidateResult = {
  consolidated: false,
  memoriesProcessed: 0,
  consolidation: null,
};

const fakeQueryResponse: QueryResponse = {
  answer: 'The user prefers dark mode [Memory 1].',
  sources: [1],
  confidence: 'high',
  memoriesConsidered: 1,
  consolidationsConsidered: 0,
};

// --- Mock agents ---

function createMockIngestAgent(): IngestAgent {
  return {
    ingest: async (_text: string, _source: string) => fakeMemoryRow,
  } as unknown as IngestAgent;
}

function createMockConsolidateAgent(): ConsolidateAgent {
  return {
    consolidate: async () => fakeConsolidateSkipped,
  } as unknown as ConsolidateAgent;
}

function createMockQueryAgent(): QueryAgent {
  return {
    query: async (_question: string) => fakeQueryResponse,
  } as unknown as QueryAgent;
}

// --- Test suite ---

describe('HTTP API Routes', () => {
  let server: FastifyInstance;
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

    const deps: ServerDependencies = {
      ingestAgent: createMockIngestAgent(),
      consolidateAgent: createMockConsolidateAgent(),
      queryAgent: createMockQueryAgent(),
      memoryRepo,
      consolidationRepo,
    };

    server = Fastify({ logger: false });
    registerRoutes(server, deps);
  });

  afterEach(() => {
    db.close();
  });

  // --- GET /status ---

  it('GET /status returns 200 with status fields', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('running');
    expect(typeof body.memories).toBe('number');
    expect(typeof body.consolidated).toBe('number');
    expect(typeof body.consolidations).toBe('number');
    expect(typeof body.uptime).toBe('number');
  });

  // --- GET /memories ---

  it('GET /memories returns 200 with empty array initially', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/memories',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memories).toEqual([]);
  });

  // --- GET /query ---

  it('GET /query without q parameter returns 400', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/query',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toContain('required');
  });

  it('GET /query with empty q parameter returns 400', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/query?q=',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toContain('required');
  });

  it('GET /query with valid q returns 200 with query response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/query?q=What+are+the+user+preferences',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.answer).toBe(fakeQueryResponse.answer);
    expect(body.sources).toEqual(fakeQueryResponse.sources);
    expect(body.confidence).toBe(fakeQueryResponse.confidence);
  });

  // --- POST /ingest ---

  it('POST /ingest with valid body returns 201', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/ingest',
      payload: { text: 'I prefer dark mode' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('ingested');
    expect(body.memory).toBeDefined();
    expect(body.memory.id).toBe(fakeMemoryRow.id);
  });

  it('POST /ingest with source field returns 201', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/ingest',
      payload: { text: 'I prefer dark mode', source: 'test' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe('ingested');
  });

  it('POST /ingest without text returns 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/ingest',
      payload: { source: 'api' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /ingest with empty text returns 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/ingest',
      payload: { text: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  // --- POST /consolidate ---

  it('POST /consolidate with no memories returns 200 with status skipped', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/consolidate',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('skipped');
    expect(body.memoriesProcessed).toBe(0);
    expect(body.consolidation).toBeNull();
  });

  // --- POST /delete ---

  it('POST /delete without id returns 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/delete',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /delete with non-existent id returns 200 with deleted false', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/delete',
      payload: { id: 9999 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deleted).toBe(false);
    expect(body.status).toBe('not_found');
  });

  it('POST /delete with existing id returns 200 with deleted true', async () => {
    // Insert a real memory first
    await memoryRepo.insert({
      source: 'api',
      rawText: 'test',
      summary: 'test summary',
      entities: '[]',
      topics: '[]',
      importance: 0.5,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/delete',
      payload: { id: 1 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.deleted).toBe(true);
    expect(body.status).toBe('deleted');
  });

  // --- POST /clear ---

  it('POST /clear returns 200 with counts', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/clear',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('cleared');
    expect(typeof body.memoriesCleared).toBe('number');
    expect(typeof body.consolidationsCleared).toBe('number');
  });

  it('POST /clear after inserting data returns correct counts', async () => {
    // Insert some data
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
      importance: 0.6,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/clear',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.memoriesCleared).toBe(2);
  });
});
