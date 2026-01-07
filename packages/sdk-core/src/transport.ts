/**
 * HTTP transport for sending events to ingestion API
 * 
 * Design trade-offs:
 * - Silent failures: Never throw errors to calling code (SDK must never block)
 * - Retry logic: Simple exponential backoff for transient failures
 * - Batch sending: Reduces HTTP overhead
 * - Timeout: Prevents hanging requests
 * - Circuit breaker pattern: Could be added for production to avoid hammering down APIs
 */

import { XRDecisionEvent, XRRun, XRStep } from '@xray/shared-types';

export interface TransportConfig {
  apiUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: TransportConfig = {
  apiUrl: 'http://localhost:3000',
  timeoutMs: 5000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * HTTP transport that sends events to the ingestion API
 * 
 * Trade-off: We use fetch API (Node 18+) for simplicity. For production,
 * consider using a more robust HTTP client (e.g., axios, got) with better
 * connection pooling and retry logic.
 */
export class HttpTransport {
  private config: TransportConfig;

  constructor(config: Partial<TransportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Send a batch of decision events
   * 
   * Trade-off: We catch all errors and return void. This ensures the SDK
   * never throws, but means errors are silently swallowed. In production,
   * consider adding an error callback or event emitter for monitoring.
   */
  async sendDecisionEvents(events: XRDecisionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      // Send to /ingest endpoint with type and data
      await this.sendWithRetry('/ingest', {
        type: 'decisions',
        data: events,
      });
    } catch (error) {
      // Silent failure - SDK must never block application logic
      // Trade-off: We lose observability of SDK failures, but maintain
      // application stability. Consider logging to a separate error tracking system.
    }
  }

  /**
   * Send run metadata
   */
  async sendRun(run: XRRun): Promise<void> {
    try {
      await this.sendWithRetry('/ingest', {
        type: 'run',
        data: run,
      });
    } catch (error) {
      // Silent failure
    }
  }

  /**
   * Send step metadata
   */
  async sendStep(step: XRStep): Promise<void> {
    try {
      await this.sendWithRetry('/ingest', {
        type: 'step',
        data: step,
      });
    } catch (error) {
      // Silent failure
    }
  }

  /**
   * Send with exponential backoff retry
   * 
   * Trade-off: Simple retry logic. For production, consider:
   * - Jitter to avoid thundering herd
   * - Circuit breaker to stop retrying when API is consistently down
   * - Different retry strategies for different error types
   */
  private async sendWithRetry(
    endpoint: string,
    data: unknown
  ): Promise<void> {
    const url = `${this.config.apiUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Success - return immediately
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on abort (timeout) or if we've exhausted retries
        if (
          lastError.name === 'AbortError' ||
          attempt >= this.config.maxRetries
        ) {
          throw lastError;
        }

        // Exponential backoff: wait before retry
        // Trade-off: Fixed exponential backoff. Consider adding jitter
        // to prevent synchronized retries from multiple clients.
        const delay = this.config.retryDelayMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    // If we get here, all retries failed
    throw lastError || new Error('Unknown error');
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

