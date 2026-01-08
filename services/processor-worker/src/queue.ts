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
  // RabbitMQ-specific fields for acknowledgment
  _deliveryTag?: number;
  _channel?: any;
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

  /**
   * Acknowledge a message (for RabbitMQ)
   */
  acknowledgeMessage(message: QueueMessage): Promise<void>;

  /**
   * Negative acknowledge a message (for RabbitMQ, re-queue)
   */
  nackMessage(message: QueueMessage): Promise<void>;
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

  async acknowledgeMessage(message: QueueMessage): Promise<void> {
    // In-memory queue doesn't need acknowledgment
  }

  async nackMessage(message: QueueMessage): Promise<void> {
    // In-memory queue doesn't need nack
  }

  /**
   * Check if message was already processed (idempotency)
   */
  isProcessed(messageId: string): boolean {
    return this.processedIds.has(messageId);
  }
}

/**
 * RabbitMQ queue implementation (production-ready message broker)
 */
export class RabbitMQQueue implements EventQueue {
  private connection: any = null;
  private channel: any = null;
  private decisionQueue = 'xray.decisions';
  private runsQueue = 'xray.runs';
  private stepsQueue = 'xray.steps';
  private isConnecting = false;

  constructor(amqpUrl?: string) {
    const url = amqpUrl || process.env.AMQP_URL || 'amqp://localhost:5672';
    this.connect(url);
  }

  private async connect(url: string): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const amqp = require('amqplib');
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // Declare durable queues
      await this.channel.assertQueue(this.decisionQueue, { durable: true });
      await this.channel.assertQueue(this.runsQueue, { durable: true });
      await this.channel.assertQueue(this.stepsQueue, { durable: true });

      // Set prefetch (how many unacked messages per consumer)
      await this.channel.prefetch(10);

      this.connection.on('error', (err: Error) => {
        console.error('RabbitMQ connection error', err);
        this.connection = null;
        this.channel = null;
        this.isConnecting = false;
      });

      this.connection.on('close', () => {
        console.warn('RabbitMQ connection closed, will reconnect');
        this.connection = null;
        this.channel = null;
        this.isConnecting = false;
      });
    } catch (error) {
      console.error('Failed to connect to RabbitMQ', error);
      this.isConnecting = false;
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.channel) return true;
    
    const url = process.env.AMQP_URL || 'amqp://localhost:5672';
    await this.connect(url);
    return !!this.channel;
  }

  async poll(maxMessages: number = 10): Promise<QueueMessage[]> {
    try {
      if (!(await this.ensureConnected())) return [];

      const messages: QueueMessage[] = [];
      const queues = [
        { name: this.decisionQueue, type: 'decision' as const },
        { name: this.stepsQueue, type: 'step' as const },
        { name: this.runsQueue, type: 'run' as const },
      ];

      // Poll from all queues (priority: decisions > steps > runs)
      for (const queue of queues) {
        if (messages.length >= maxMessages) break;

        // Get message (non-blocking, noAck: false means we need to ack manually)
        const msg = await this.channel.get(queue.name, { noAck: false });
        
        if (msg && msg.fields && msg.fields.deliveryTag !== undefined) {
          const data = JSON.parse(msg.content.toString());
          messages.push({
            type: queue.type,
            data: data,
            messageId: msg.properties?.messageId || `${queue.type}-${data.id || Date.now()}`,
            _deliveryTag: msg.fields.deliveryTag,
            _channel: this.channel,
          });
        }
      }

      return messages;
    } catch (error) {
      return [];
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    // For RabbitMQ, acknowledgment is handled via acknowledgeMessage
  }

  async acknowledgeMessage(message: QueueMessage): Promise<void> {
    try {
      if (message._deliveryTag !== undefined && this.channel) {
        this.channel.ack(message._deliveryTag);
      }
    } catch (error) {
      // Silent failure - message might already be acked
    }
  }

  async nackMessage(message: QueueMessage): Promise<void> {
    try {
      if (message._deliveryTag !== undefined && this.channel) {
        this.channel.nack(message._deliveryTag, false, true);
      }
    } catch (error) {
      // Silent failure
    }
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

  async acknowledgeMessage(message: QueueMessage): Promise<void> {
    // HTTP queue handles acknowledgment via deleteMessage
    if (message.messageId) {
      await this.deleteMessage(message.messageId);
    }
  }

  async nackMessage(message: QueueMessage): Promise<void> {
    // HTTP queue doesn't support nack
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

  if (queueType === 'rabbitmq') {
    return new RabbitMQQueue();
  }

  if (queueType === 'http') {
    const queueUrl = process.env.QUEUE_URL || 'http://localhost:3002';
    return new HttpQueue(queueUrl);
  }

  throw new Error(`Unknown queue type: ${queueType}. Supported: memory, rabbitmq, http`);
}

