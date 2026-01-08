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
 * Redis queue implementation (shared queue for ingestion and processor)
 */
export class RedisQueue implements EventQueue {
  private client: any;
  private decisionEventsKey = 'xray:queue:decisions';
  private runsKey = 'xray:queue:runs';
  private stepsKey = 'xray:queue:steps';

  constructor(redisUrl?: string) {
    // Lazy import to avoid requiring redis if not used
    const redis = require('redis');
    this.client = redis.createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
    });
    this.client.on('error', (err: Error) => {
      console.error('Redis Client Error', err);
    });
    this.client.connect().catch((err: Error) => {
      console.error('Redis connection error', err);
    });
  }

  async poll(maxMessages: number = 10): Promise<QueueMessage[]> {
    try {
      const messages: QueueMessage[] = [];
      
      // Poll from all three queues (priority: decisions > steps > runs)
      // Use rPop to get one message at a time
      while (messages.length < maxMessages) {
        // Try decisions first
        const decisionData = await this.client.rPop(this.decisionEventsKey);
        if (decisionData) {
          const event = typeof decisionData === 'string' ? JSON.parse(decisionData) : decisionData;
          messages.push({
            type: 'decision',
            data: event,
            messageId: `decision-${event.id || Date.now()}-${Math.random()}`,
          });
          if (messages.length >= maxMessages) break;
        }

        // Try steps
        const stepData = await this.client.rPop(this.stepsKey);
        if (stepData) {
          const step = typeof stepData === 'string' ? JSON.parse(stepData) : stepData;
          messages.push({
            type: 'step',
            data: step,
            messageId: `step-${step.id || Date.now()}-${Math.random()}`,
          });
          if (messages.length >= maxMessages) break;
        }

        // Try runs
        const runData = await this.client.rPop(this.runsKey);
        if (runData) {
          const run = typeof runData === 'string' ? JSON.parse(runData) : runData;
          messages.push({
            type: 'run',
            data: run,
            messageId: `run-${run.id || Date.now()}-${Math.random()}`,
          });
          if (messages.length >= maxMessages) break;
        }

        // If no messages found, break
        if (!decisionData && !stepData && !runData) {
          break;
        }
      }

      return messages;
    } catch (error) {
      return [];
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    // Redis rPop already removes the message, so nothing to do here
    // This is for idempotency tracking if needed
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

  if (queueType === 'redis') {
    return new RedisQueue();
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

