# Refined Request: TypeScript Always-On Memory Agent for User Preference Persistence

## Objective

Build a TypeScript implementation of Google's Always-On Memory Agent -- a persistent, evolving memory system that runs as a lightweight background process, continuously processing, consolidating, and connecting information. The system must be adapted specifically to support user preference management across multiple agents, enabling any agent in the platform to remember and leverage user preferences over time.

## Scope

### In Scope

1. **Core Memory Engine (TypeScript)**
   - IngestAgent: Processes incoming user preference data and contextual information, extracts structured metadata (entities, topics, importance scores)
   - ConsolidateAgent: Periodically reviews stored memories, identifies patterns and connections between preferences, compresses related information into consolidated insights
   - QueryAgent: Answers natural language queries against stored memories and consolidation insights, providing answers with source citations

2. **Persistence Layer**
   - SQLite database for memory storage (aligned with the original design's lightweight approach)
   - Three tables: Memory (individual preference/information units), Consolidation (cross-memory patterns), ProcessedFile (ingestion tracking)
   - Table naming follows singular convention per project standards

3. **HTTP API**
   - RESTful API endpoints for: ingesting preferences, querying memories, triggering consolidation, listing memories, viewing status, deleting/clearing memories
   - Must be framework-agnostic but leverage a TypeScript HTTP server (e.g., Express, Fastify, or Hono)

4. **File Watcher**
   - Monitor a designated inbox folder for new files
   - Support text-based file formats at minimum (txt, md, json, csv, yaml, xml)
   - Auto-ingest and track processed files to prevent duplication

5. **Consolidation Loop**
   - Background timer-based process that periodically reviews unconsolidated memories
   - Configurable interval (default behavior defined by configuration, no fallback values)

6. **LLM Integration via LangChain.js**
   - Use LangChain.js as the LLM abstraction layer to support multiple providers (OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI, etc.) through a unified interface
   - LLM provider and model are configurable via configuration settings
   - No vendor lock-in -- switching providers requires only a configuration change

7. **Agent Integration API**
   - A client library or SDK that other agents can import to read/write user preferences
   - Simple interface: `ingest(text, source)`, `query(question)`, `getPreferences(category)`

8. **Dashboard (Optional/Phase 2)**
   - Streamlit-equivalent web UI for memory visualization and management
   - Can be deferred to a later phase

### Out of Scope

1. Multimodal processing (images, audio, video) -- focus on text-based preferences initially
2. Google ADK framework dependency -- replace with a TypeScript-native agent orchestration approach
3. Google Cloud Platform specific integrations
4. User authentication and multi-tenancy (userId field included in schema for forward-compatibility, but auth/multi-tenancy not implemented)
5. Distributed deployment or clustering
6. Real-time streaming/WebSocket interfaces (HTTP polling is sufficient)

## Functional Requirements

1. **FR-01: Memory Ingestion** -- The system must accept text input (via API or file watcher), process it through an LLM to extract a structured summary, entities, topics, and an importance score (0.0-1.0), and persist the result in the database.

2. **FR-02: Memory Consolidation** -- The system must periodically (at a configurable interval) review all unconsolidated memories (minimum 2), identify cross-cutting patterns and relationships, generate consolidated insights, and mark processed memories as consolidated.

3. **FR-03: Memory Query** -- The system must accept natural language questions, retrieve relevant memories and consolidation insights, and return synthesized answers with source citations.

4. **FR-04: File Watching** -- The system must monitor a configurable directory for new files, automatically ingest supported file types, and track processed files to prevent re-ingestion.

5. **FR-05: Memory Management** -- The system must support listing all memories, deleting individual memories by ID, clearing all memories, and retrieving memory statistics (total count, consolidated count, consolidation count).

6. **FR-06: HTTP API** -- The system must expose RESTful endpoints: `GET /status`, `GET /memories`, `GET /query?q=...`, `POST /ingest`, `POST /consolidate`, `POST /delete`, `POST /clear`.

7. **FR-07: User Preference Focus** -- The ingestion agent must be specifically tuned (via system prompts) to identify and prioritize user preferences, behavioral patterns, and stated desires from incoming text.

8. **FR-08: Agent Integration** -- The system must provide a programmatic client interface (TypeScript module) that other agents can import to interact with the memory system without direct HTTP calls.

9. **FR-09: Configuration Management** -- All configuration parameters (LLM API key, LLM model, database path, watch directory, API port, consolidation interval) must be loaded from configuration. Missing required configuration must raise an exception -- no fallback or default values.

10. **FR-10: Graceful Startup/Shutdown** -- The system must initialize the database schema on first run, start background processes (file watcher, consolidation loop), and handle shutdown signals cleanly.

## Technical Constraints

1. **Language**: TypeScript (all tools and implementation code per project conventions)
2. **Configuration**: No fallback values for configuration settings; missing config must raise exceptions
3. **Database Naming**: Singular table names (e.g., `Memory`, `Consolidation`, `ProcessedFile`)
4. **Tool Documentation**: All tools must be documented in CLAUDE.md using the XML format specified in project conventions
5. **Runtime**: Node.js (LTS version)
6. **Package Manager**: npm or yarn (standard TypeScript project tooling)
7. **LLM Provider**: Use LangChain.js (@langchain/core + provider packages) for LLM abstraction; provider/model configurable via settings
8. **Database**: SQLite via better-sqlite3 or similar TypeScript-compatible library
9. **No SQLAlchemy**: Not applicable (TypeScript project), but similarly avoid heavy ORM layers -- prefer lightweight query builders or direct SQL

## Acceptance Criteria

1. **AC-01**: Running the application starts an HTTP server, a file watcher, and a consolidation loop -- all configurable via environment variables or config file.
2. **AC-02**: Posting text to `/ingest` stores a memory with extracted summary, entities, topics, and importance score in the SQLite database.
3. **AC-03**: Dropping a `.txt` or `.md` file into the watched directory triggers automatic ingestion within 10 seconds.
4. **AC-04**: After ingesting 3+ memories, triggering `/consolidate` produces at least one consolidation record linking related memories.
5. **AC-05**: Querying `/query?q=<question>` returns a synthesized answer referencing stored memories.
6. **AC-06**: The client library can be imported by another TypeScript project and successfully calls `ingest()`, `query()`, and `getPreferences()`.
7. **AC-07**: Starting the application with a missing required configuration variable (e.g., LLM API key) throws a clear error message and exits.
8. **AC-08**: All tools developed are documented in CLAUDE.md following the XML documentation format.
9. **AC-09**: The system handles at least 50 memories without performance degradation in query response.
10. **AC-10**: Memory statistics endpoint returns accurate counts of total memories, consolidated memories, and consolidation records.

## Resolved Questions

1. **LLM Provider Selection**: RESOLVED -- Use LangChain.js as the abstraction layer. LLM provider and model are configurable via settings. Supports OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI, and others through LangChain's unified interface.

2. **Multi-User Support**: RESOLVED -- Include `userId` field in the database schema from the start for forward-compatibility. Not actively enforced in Phase 1 but ready for future multi-tenancy.

3. **Preference Categories**: RESOLVED -- Use free-form categorization via LLM extraction. No fixed taxonomy; the LLM dynamically identifies and assigns categories from content.

4. **Dashboard Priority**: RESOLVED -- Deferred to Phase 2. Focus on core engine and API first.

## Open Questions

1. **Memory Retention Policy**: Should there be a maximum memory count or age-based cleanup policy? The original implementation has no such limits, but long-term use could accumulate significant data.

2. **Agent Communication Protocol**: For the agent integration API (FR-08), should other agents communicate via direct HTTP calls, via a shared library import, or both? The refined request assumes both, but the priority should be clarified.

## Source Analysis

### What the Google Always-On Memory Agent Does

The Google Always-On Memory Agent (from `GoogleCloudPlatform/generative-ai`) is a Python-based system built on Google ADK (Agent Development Kit) and Gemini 3.1 Flash-Lite. Its core innovation is treating AI memory like the human brain during sleep: rather than passively storing and retrieving information (like vector databases or RAG systems), it actively processes, connects, and compresses information over time.

### Architecture

The system consists of four agents orchestrated by Google ADK:

1. **IngestAgent** -- Processes incoming data across 27 file types (text, images, audio, video, PDFs) using Gemini's multimodal capabilities. Extracts structured metadata: summary, entities, topics, and importance rating (0.0-1.0).

2. **ConsolidateAgent** -- Runs on a configurable timer (default: 30 minutes). Reviews unconsolidated memories, identifies cross-cutting patterns, generates synthesized insights, and compresses related information.

3. **QueryAgent** -- Answers natural language questions by reading all stored memories and consolidation insights. Provides answers with source citations.

4. **MemoryOrchestrator** -- Routes incoming requests to the appropriate sub-agent.

### Technology Stack

- **Python** with async/await (aiohttp for HTTP)
- **Google ADK** for agent orchestration
- **Gemini 3.1 Flash-Lite** for all LLM operations (chosen for speed and cost)
- **SQLite** for persistence (3 tables: memories, consolidations, processed_files)
- **Streamlit** for the optional dashboard UI

### Key Design Decisions

- **No vector database or embeddings** -- relies entirely on direct LLM processing of memory text
- **Active consolidation** -- periodically synthesizes connections rather than waiting for query-time retrieval
- **Lightweight persistence** -- SQLite rather than a dedicated database server
- **File watcher pattern** -- monitors an inbox directory every 5 seconds for new files
- **HTTP API** -- simple REST endpoints for programmatic access

### Database Schema (Original)

- `memories`: id, source, raw_text, summary, entities (JSON), topics (JSON), importance (float), consolidated (boolean), connections (JSON), timestamp
- `consolidations`: id, memory_ids (JSON), summary, key_insights (JSON), timestamp
- `processed_files`: id, file_path (unique), timestamp

### Feasibility Assessment

The solution is highly feasible for a TypeScript port with the following considerations:

- **LLM Integration**: The core logic is LLM-provider agnostic at its heart -- prompts can be adapted for any provider. The Google ADK dependency can be replaced with direct LLM API calls or a lightweight TypeScript agent framework.
- **SQLite**: Excellent TypeScript support via `better-sqlite3` or `sql.js`.
- **File Watching**: Node.js has native `fs.watch` and mature libraries like `chokidar`.
- **HTTP Server**: Multiple excellent options (Express, Fastify, Hono).
- **Async Processing**: Node.js's event loop naturally supports the background processing pattern.
- **User Preference Adaptation**: The system prompt tuning required to focus on user preferences is straightforward -- it involves modifying the agent system instructions to prioritize preference extraction and categorization.

The main architectural change is replacing Google ADK's agent orchestration with a simpler TypeScript-native approach, since the agent routing logic is straightforward (ingest/consolidate/query) and does not require a full framework.

## Original Request

"I want you to study the always on memory agent proposal from google at the https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent and build a typescript version of it. I plan to use it to support user preferences on other agents I build. I want to create an option for my agents to remember the user preferences. So I want you to examine the feasibility of the solution and proceed accordingly."
