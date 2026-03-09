import { z } from 'zod';

/**
 * Schema for IngestAgent LLM output.
 * Validates the structured metadata extracted from ingested text.
 */
export const MemoryExtractionSchema = z.object({
  summary: z
    .string()
    .describe('Concise 1-2 sentence summary focusing on the user preference or pattern'),
  entities: z
    .array(z.string())
    .describe('Key entities: people, products, features, settings, tools, categories'),
  topics: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe('2-4 lowercase hyphenated topic tags (e.g., "ui-preferences", "workflow")'),
  importance: z
    .number()
    .min(0)
    .max(1)
    .describe('Importance rating from 0.0 (trivial) to 1.0 (critical preference)'),
});

/**
 * Schema for ConsolidateAgent LLM output.
 * Validates the cross-memory patterns and connections.
 */
export const ConsolidationResultSchema = z.object({
  summary: z
    .string()
    .describe('Synthesized summary of preference patterns across the provided memories'),
  insight: z
    .string()
    .describe('One actionable insight for agents to leverage when serving this user'),
  connections: z
    .array(
      z.object({
        fromId: z.number().describe('Source memory ID'),
        toId: z.number().describe('Target memory ID'),
        relationship: z
          .string()
          .describe(
            'Relationship type: complementary, contradictory, reinforces, evolves_from, related'
          ),
      })
    )
    .describe('Connections between specific memories'),
});

/**
 * Schema for QueryAgent LLM output.
 * Validates the synthesized answer with citations.
 */
export const QueryResultSchema = z.object({
  answer: z
    .string()
    .describe(
      'Synthesized answer citing memories as [Memory X] and consolidations as [Consolidation X]'
    ),
  sourceMemoryIds: z
    .array(z.number())
    .describe('List of memory IDs referenced in the answer'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Confidence level based on available evidence'),
});
