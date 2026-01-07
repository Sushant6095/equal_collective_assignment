/**
 * Queue abstraction for polling events
 * 
 * Design: Abstract interface for queue operations. Currently implements
 * in-memory queue for MVP, but designed to swap for SQS.
 */

import {
  XRDecisionEvent,
  XRRun,
  XRStep,
} from '@xray/shared-types';

export interface QueueMessage {
  type: 'decision' | 'decisions' | 'run' | 'step';
  data: XRDecisionEvent | XRDecisionEvent[] | XRRun | XRStep;
  messageId?: string; // For idempotency tracking
}

/**
 * Queue interface for polling events
 * 
 * Trade-off: Simple polling interface. For production SQS, consider:
 * - Long polling
 * - Visibility timeout
 * - Dead letter queues
 * - Batch operations
 */
export interface EventQueue {
  /**
   * Poll for messages (non-blocking, returns empty array if none available)
   * 
   * @param maxMessages Maximum number of messages to return
   * @returns Array of messages
   */
  poll(maxMessages?: number): Promise<QueueMessage[]>;

  /**
   * Delete a message after successful processing (acknowledge)
   */
  deleteMessage(messageId: string): Promise<void>;
}

/**
 * In-memory queue implementation (MVP)
 * 
 * For production, implement SQS adapter:
 * - Use AWS SDK v3
 * - Long polling with ReceiveMessage
 * - DeleteMessage for acknowledgment
 */
export class InMemoryQueue implements EventQueue {
  private messages: QueueMessage[] = [];
  private processedIds: Set<string> = new Set();

  constructor() {
    // For MVP, we'll simulate queue by accepting messages via add()
    // In production, this would connect to SQS
  }

  /**
   * Add message to queue (for testing/simulation)
   */
  add(message: QueueMessage): void {
    const messageId = message.messageId || `msg-${Date.now()}-${Math.random()}`;
    this.messages.push({ ...message, messageId });
  }

  async poll(maxMessages: number = 10): Promise<QueueMessage[]> {
    const result = this.messages.splice(0, maxMessages);
    return result;
  }

  async deleteMessage(messageId: string): Promise<void> {
    this.processedIds.add(messageId);
    // In real SQS, this would delete the message
  }

  /**
   * Check if message was already processed (idempotency)
   */
  isProcessed(messageId: string): boolean {
    return this.processedIds.has(messageId);
  }
}

/**
 * HTTP queue implementation (for local development with queue-service)
 */
export class HttpQueue implements EventQueue {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async poll(maxMessages: number = 10): Promise<QueueMessage[]> {
    try {
      const response = await fetch(`${this.baseUrl}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMessages }),
      });
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { messages?: QueueMessage[] };
      return data.messages || [];
    } catch (error) {
      return [];
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
    } catch (error) {
      // Silent failure
    }
  }
}

/**
 * Factory function to create queue instance
 */
export function createQueue(): EventQueue {
  const queueType = process.env.QUEUE_TYPE || 'memory';

  if (queueType === 'memory') {
    return new InMemoryQueue();
  }

  if (queueType === 'http') {
    const queueUrl = process.env.QUEUE_URL || 'http://localhost:3002';
    return new HttpQueue(queueUrl);
  }

  // Future: Add SQS implementation
  // if (queueType === 'sqs') {
  //   return new SQSQueue({ ... });
  // }

  throw new Error(`Unknown queue type: ${queueType}`);
}

