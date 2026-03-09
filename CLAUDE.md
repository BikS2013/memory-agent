# Always-On Memory Agent - Project Memory

## Configuration Default Value Exceptions

The following configuration parameters are permitted to use default/fallback values, as exceptions to the project-wide "no fallback" rule:

1. **MemoryClientConfig.timeoutMs** (default: 30000ms / 30 seconds)
   - Location: `src/client/types.ts` / `src/client/memory-client.ts`
   - Rationale: This is the Client SDK (Unit H) used by external consumers/agents. External consumers expect a sensible default timeout without being forced to configure one. This default does not affect the server-side configuration, which remains strict about requiring all values.
   - Approved: 2026-03-09

## Tools

<always-memory-agent>
    <objective>
        Starts the Always-On Memory Agent -- a persistent background service that ingests, consolidates, and queries user preference memories via an HTTP API, file watcher, and periodic consolidation loop.
    </objective>
    <command>
        npx tsx src/index.ts
        # or after build:
        node dist/index.js
    </command>
    <info>
        The main application entry point that launches three subsystems:
        1. HTTP API (Fastify) -- RESTful endpoints for memory management
        2. File Watcher (chokidar) -- monitors an inbox directory for new files to auto-ingest
        3. Consolidation Loop -- periodic background task that synthesizes cross-memory insights

        Required environment variables (all mandatory, no defaults):
        - LLM_PROVIDER: LLM provider to use ("openai" | "anthropic" | "google-genai")
        - LLM_MODEL: Model identifier (e.g., "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.0-flash")
        - LLM_API_KEY: API key for the chosen LLM provider
        - DATABASE_PATH: Path to the SQLite database file (e.g., "./data/memory.db")
        - WATCH_DIRECTORY: Directory to watch for new files (e.g., "./inbox")
        - API_PORT: Port number for the HTTP server (e.g., "8888")
        - CONSOLIDATION_INTERVAL_MS: Consolidation loop interval in milliseconds (e.g., "1800000")

        HTTP API endpoints:
        - GET  /status       -- Returns system status, uptime, and memory statistics
        - GET  /memories     -- Lists all stored memories
        - GET  /query?q=...  -- Queries memories with a natural language question
        - POST /ingest       -- Ingests text: body { "text": "...", "source": "..." }
        - POST /consolidate  -- Triggers manual consolidation of unconsolidated memories
        - POST /delete       -- Deletes a memory: body { "id": <number> }
        - POST /clear        -- Clears all memories and consolidations

        Examples:
        # Start the server
        LLM_PROVIDER=openai LLM_MODEL=gpt-4o LLM_API_KEY=sk-... DATABASE_PATH=./data/memory.db WATCH_DIRECTORY=./inbox API_PORT=8888 CONSOLIDATION_INTERVAL_MS=1800000 npx tsx src/index.ts

        # Ingest a preference
        curl -X POST http://localhost:8888/ingest -H "Content-Type: application/json" -d '{"text": "I prefer dark mode in all applications", "source": "manual"}'

        # Query preferences
        curl "http://localhost:8888/query?q=What+are+the+UI+preferences?"

        # Check status
        curl http://localhost:8888/status
    </info>
</always-memory-agent>

<memory-client-sdk>
    <objective>
        TypeScript client SDK that allows external agents to interact with the Always-On Memory Agent programmatically without direct HTTP calls.
    </objective>
    <command>
        import { MemoryClient } from 'always-memory-on/client';
    </command>
    <info>
        A lightweight client library exportable via the package's "./client" export path.
        External TypeScript projects can install and import it to read/write user preferences.

        Constructor:
        - new MemoryClient({ baseUrl: string, timeoutMs?: number })
          - baseUrl (required): The base URL of the running memory agent (e.g., "http://localhost:8888")
          - timeoutMs (optional): Request timeout in milliseconds (defaults to 30000)

        Methods:
        - ingest(text: string, source?: string): Promise<ClientIngestResponse>
            Sends text to the memory agent for ingestion. Returns the stored memory record.
        - query(question: string): Promise<ClientQueryResponse>
            Asks a natural language question against stored memories. Returns a synthesized answer with source citations.
        - getPreferences(category?: string): Promise<ClientPreferencesResponse>
            Retrieves stored preferences, optionally filtered by topic/category.
        - getStatus(): Promise<ClientStatusResponse>
            Returns the current system status and memory statistics.

        Exported types:
        - MemoryClientConfig, ClientIngestResponse, ClientQueryResponse, ClientPreferencesResponse, ClientStatusResponse

        Examples:
        # Import and use in another agent
        import { MemoryClient } from 'always-memory-on/client';

        const memory = new MemoryClient({ baseUrl: 'http://localhost:8888' });

        // Ingest a user preference
        await memory.ingest('User prefers dark mode', 'my-agent');

        // Query preferences
        const result = await memory.query('What are the UI preferences?');
        console.log(result.answer);

        // Get preferences by category
        const prefs = await memory.getPreferences('ui-preferences');
        console.log(prefs.preferences);

        // Check system status
        const status = await memory.getStatus();
        console.log(status);
    </info>
</memory-client-sdk>
