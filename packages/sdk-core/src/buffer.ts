/**
 * Async buffer for batching events. Non-blocking, drops oldest if full.
 */

import { XRDecisionEvent } from '@xray/shared-types';

export interface BufferConfig {
  maxSize: number; // Maximum events before forced flush
  flushIntervalMs: number; // Time-based flush interval
  batchSize: number; // Target batch size for sending
}

const DEFAULT_CONFIG: BufferConfig = {
  maxSize: 1000,
  flushIntervalMs: 5000, // 5 seconds
  batchSize: 100,
};

/**
 * Batches events and sends them async. Simple array buffer for now.
 */
export class EventBuffer {
  private buffer: XRDecisionEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private flushCallback: (events: XRDecisionEvent[]) => Promise<void>;

  constructor(
    flushCallback: (events: XRDecisionEvent[]) => Promise<void>,
    config: Partial<BufferConfig> = {}
  ) {
    this.flushCallback = flushCallback;
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    this.startPeriodicFlush(finalConfig.flushIntervalMs);
  }

  /**
   * Add event to buffer. Non-blocking - might lose events on crash.
   */
  add(event: XRDecisionEvent): void {
    // Drop oldest if buffer is full (better than blocking)
    if (this.buffer.length >= DEFAULT_CONFIG.maxSize) {
      this.buffer.shift(); // Remove oldest
    }

    this.buffer.push(event);

    // Trigger flush if we've reached batch size
    // Fire-and-forget: don't await to avoid blocking
    if (this.buffer.length >= DEFAULT_CONFIG.batchSize) {
      this.flush().catch(() => {
        // Silently fail - transport layer will handle retries
      });
    }
  }

  /**
   * Flush all buffered events. Prevents concurrent flushes.
   */
  private async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    this.isFlushing = true;
    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      await this.flushCallback(eventsToSend);
    } catch (error) {
      // Drop events if flush fails (avoid infinite retry loops)
      console.warn('[XRay] Failed to flush events, dropping batch:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Start periodic flushing to prevent stale data
   */
  private startPeriodicFlush(intervalMs: number): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently fail
      });
    }, intervalMs);
  }

  /**
   * Force immediate flush (e.g., on shutdown)
   * 
   * Note: This is the only potentially blocking operation, but it's
   * only called during graceful shutdown, which is acceptable.
   */
  async forceFlush(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Get current buffer size (for monitoring)
   */
  getSize(): number {
    return this.buffer.length;
  }
}

