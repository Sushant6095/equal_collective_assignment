/**
 * Async buffer for batching decision events
 * 
 * Design trade-offs:
 * - Non-blocking: All operations are fire-and-forget to never block application logic
 * - Batching: Events are batched to reduce HTTP overhead
 * - Size-based flushing: Flush when buffer reaches max size
 * - Time-based flushing: Flush periodically even if buffer isn't full (prevents stale data)
 * - Loss tolerance: If buffer is full, we drop oldest events (FIFO) rather than blocking
 */

import { XRDecisionEvent } from '../../shared-types/src/index.js';

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
 * Non-blocking buffer that batches events and sends them asynchronously
 * 
 * Trade-off: We use a simple array-based buffer. For high-throughput scenarios,
 * consider a ring buffer or queue data structure to avoid array resizing overhead.
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
   * Add an event to the buffer (non-blocking)
   * 
   * Trade-off: We don't await the flush to avoid blocking.
   * This means events might be lost if the process crashes before flush.
   * For critical events, consider a synchronous flush option.
   */
  add(event: XRDecisionEvent): void {
    // If buffer is full, drop oldest event (FIFO)
    // Trade-off: Dropping is better than blocking, but we lose data.
    // Alternative: Could use backpressure or blocking, but violates "never block" requirement.
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
   * Flush all buffered events
   * 
   * Trade-off: We prevent concurrent flushes to avoid race conditions,
   * but this means if a flush is slow, new events will accumulate.
   * For high-throughput, consider multiple buffers or worker threads.
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
      // If flush fails, we could re-add events, but that risks infinite loops.
      // Instead, we drop them and rely on application-level retries if needed.
      // Trade-off: Data loss vs. memory/retry complexity
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

