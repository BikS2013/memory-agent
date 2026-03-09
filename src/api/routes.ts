/**
 * Fastify route definitions for the Always-On Memory Agent HTTP API.
 */

import type { FastifyInstance } from 'fastify';
import type { ServerDependencies, IngestRequestBody, DeleteRequestBody } from './types.js';

const serverStartTime = Date.now();

/**
 * Registers all API routes on the given Fastify instance.
 */
export function registerRoutes(fastify: FastifyInstance, deps: ServerDependencies): void {
  const { ingestAgent, consolidateAgent, queryAgent, memoryRepo, consolidationRepo } = deps;

  // GET /status - Returns system status and statistics
  fastify.get('/status', async (_request, reply) => {
    try {
      const stats = memoryRepo.getStats();
      const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

      return reply.send({
        status: 'running',
        memories: stats.total,
        consolidated: stats.consolidated,
        consolidations: stats.consolidations,
        uptime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // GET /memories - Returns all stored memories
  fastify.get('/memories', async (_request, reply) => {
    try {
      const memories = memoryRepo.getAll();
      return reply.send({ memories });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // GET /query - Queries the memory system with a natural language question
  fastify.get<{ Querystring: { q?: string } }>('/query', async (request, reply) => {
    try {
      const question = request.query.q;
      if (!question || question.trim() === '') {
        return reply.status(400).send({ error: 'Query parameter "q" is required', statusCode: 400 });
      }

      const result = await queryAgent.query(question);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // POST /ingest - Ingests new text into the memory system
  fastify.post<{ Body: IngestRequestBody }>(
    '/ingest',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['text'],
          properties: {
            text: { type: 'string' as const, minLength: 1 },
            source: { type: 'string' as const },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { text, source } = request.body;
        const resolvedSource = source ?? 'api';
        const memory = await ingestAgent.ingest(text, resolvedSource);

        return reply.status(201).send({ status: 'ingested', memory });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message, statusCode: 500 });
      }
    }
  );

  // POST /consolidate - Triggers memory consolidation
  fastify.post('/consolidate', async (_request, reply) => {
    try {
      const result = await consolidateAgent.consolidate();
      return reply.send({
        status: result.consolidated ? 'consolidated' : 'skipped',
        memoriesProcessed: result.memoriesProcessed,
        consolidation: result.consolidation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message, statusCode: 500 });
    }
  });

  // POST /delete - Deletes a memory by id
  fastify.post<{ Body: DeleteRequestBody }>(
    '/delete',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['id'],
          properties: {
            id: { type: 'number' as const },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.body;
        const deleted = memoryRepo.deleteById(id);

        return reply.send({
          status: deleted ? 'deleted' : 'not_found',
          deleted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message, statusCode: 500 });
      }
    }
  );

  // POST /clear - Clears all memories and consolidations
  fastify.post('/clear', async (_request, reply) => {
    try {
      const memoriesCleared = memoryRepo.deleteAll();
      const consolidationsCleared = consolidationRepo.deleteAll();

      return reply.send({
        status: 'cleared',
        memoriesCleared,
        consolidationsCleared,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}
