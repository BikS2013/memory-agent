# Always-On Memory Agent

## Purpose
TypeScript implementation of Google's Always-On Memory Agent for user preference persistence across agents. Ingests, consolidates, and queries user preferences via LLM-powered agents.

## Tech Stack
- TypeScript 5.x with strict mode, ESM modules (NodeNext)
- LangChain.js for multi-provider LLM abstraction (OpenAI, Anthropic, Google Gemini)
- better-sqlite3 for SQLite persistence
- Fastify 5.x for HTTP API
- Chokidar v4 for file watching
- Zod for schema validation
- Vitest for testing

## Architecture
- 3 AI Agents: IngestAgent, ConsolidateAgent, QueryAgent
- SQLite database: Memory, Consolidation, ProcessedFile tables (singular names)
- REST API: 7 endpoints (status, memories, query, ingest, consolidate, delete, clear)
- File watcher for auto-ingestion from inbox directory
- Background consolidation loop on configurable timer
- Client SDK (MemoryClient) for external agent integration

## Key Directories
- src/config/ - Configuration loading (env vars, no fallbacks)
- src/database/ - SQLite repositories
- src/llm/ - LangChain provider factory, Zod schemas, system prompts
- src/agents/ - IngestAgent, ConsolidateAgent, QueryAgent
- src/api/ - Fastify HTTP routes
- src/watcher/ - Chokidar file watcher
- src/consolidation/ - Timer-based consolidation loop
- src/client/ - MemoryClient SDK
- test_scripts/ - Vitest tests
- docs/design/ - Project design and plans
- docs/reference/ - Research and investigations
