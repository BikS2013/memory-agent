/**
 * ConsolidationLoop - Periodically triggers the ConsolidateAgent to find
 * patterns and connections across unconsolidated memories.
 */

import type { ConsolidateAgent } from '../agents/consolidate-agent.js';

export class ConsolidationLoop {
  private readonly consolidateAgent: ConsolidateAgent;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(consolidateAgent: ConsolidateAgent, intervalMs: number) {
    this.consolidateAgent = consolidateAgent;
    this.intervalMs = intervalMs;
  }

  /**
   * Starts the consolidation loop. The first consolidation runs after
   * the configured interval (not immediately).
   */
  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stops the consolidation loop and clears the timer.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executes a single consolidation tick. Errors are caught and logged
   * to ensure the loop continues running.
   */
  private async tick(): Promise<void> {
    try {
      const result = await this.consolidateAgent.consolidate();

      if (result.consolidated) {
        console.log(
          `[ConsolidationLoop] Consolidated ${result.memoriesProcessed} memories.`
        );
      } else {
        console.log('[ConsolidationLoop] Skipped - not enough unconsolidated memories.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ConsolidationLoop] Error during consolidation: ${message}`);
    }
  }
}
