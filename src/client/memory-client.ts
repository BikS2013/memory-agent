import type {
  MemoryClientConfig,
  ClientIngestResponse,
  ClientQueryResponse,
  ClientPreferencesResponse,
  ClientStatusResponse,
} from './types.js';

/**
 * Client SDK for the Always-On Memory Agent.
 *
 * Usage by external agents:
 *
 *   import { MemoryClient } from 'always-memory-on/client';
 *
 *   const memory = new MemoryClient({ baseUrl: 'http://localhost:8888' });
 *   await memory.ingest('User prefers dark mode', 'my-agent');
 *   const result = await memory.query('What are the UI preferences?');
 *   const prefs = await memory.getPreferences('ui-preferences');
 */
export class MemoryClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /**
   * @param config - Client configuration
   * @param config.baseUrl - Base URL of the memory agent HTTP API
   * @param config.timeoutMs - Optional request timeout in milliseconds (defaults to 30000)
   */
  constructor(config: MemoryClientConfig) {
    if (!config.baseUrl) {
      throw new Error('MemoryClient requires a baseUrl in the configuration');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  /**
   * Ingest a preference or piece of information into the memory system.
   *
   * @param text - The raw text to ingest
   * @param source - Optional source identifier (e.g., the calling agent's name)
   * @returns The ingestion result including the stored memory
   */
  async ingest(text: string, source?: string): Promise<ClientIngestResponse> {
    const response = await this.post<ClientIngestResponse>('/ingest', {
      text,
      source: source ?? 'sdk',
    });
    return response;
  }

  /**
   * Query the memory system with a natural language question.
   *
   * @param question - The question to ask about stored preferences
   * @returns The synthesized answer with source citations
   */
  async query(question: string): Promise<ClientQueryResponse> {
    const encoded = encodeURIComponent(question);
    const response = await this.get<ClientQueryResponse>(`/query?q=${encoded}`);
    return response;
  }

  /**
   * Get user preferences filtered by topic/category.
   *
   * @param category - Optional topic tag to filter by (e.g., "ui-preferences")
   * @returns Matching preference memories
   */
  async getPreferences(category?: string): Promise<ClientPreferencesResponse> {
    const memoriesResponse = await this.get<{ memories: Array<Record<string, unknown>> }>('/memories');

    const memories = memoriesResponse.memories;
    const filtered = category
      ? memories.filter((m) => {
          const topics: string[] = JSON.parse(m.topics as string);
          return topics.some((t) => t.includes(category));
        })
      : memories;

    return {
      preferences: filtered.map((m) => ({
        id: m.id as number,
        summary: m.summary as string,
        topics: JSON.parse(m.topics as string) as string[],
        importance: m.importance as number,
        createdAt: m.createdAt as string,
      })),
    };
  }

  /**
   * Get the current system status and statistics.
   *
   * @returns System status including memory counts and uptime
   */
  async getStatus(): Promise<ClientStatusResponse> {
    return this.get<ClientStatusResponse>('/status');
  }

  // ---- Private HTTP helpers ----

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Memory Agent API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Memory Agent API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
