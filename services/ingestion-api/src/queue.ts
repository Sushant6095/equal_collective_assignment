/**
 * Queue abstraction for event processing
 * 
 * Clean separation: Queue logic is isolated from HTTP and validation.
 * This abstraction allows us to swap implementations (in-memory → SQS) without
 * changing HTTP or validation code.
 * 
 * Design: In-memory queue for MVP. For production, implement SQS adapter
 * that implements the same interface.
 */

import {
  XRDecisionEvent,
  XRRun,
  XRStep,
} from '../../../packages/shared-types/src/index.js';

/**
 * Queue interface - allows swapping implementations
 * 
 * Trade-off: Simple interface. For production, consider adding:
 * - Priority queues
 * - Dead letter queues
 * - Retry policies
 * - Batch operations
 */
export interface EventQueue {
  /**
   * Push a decision event to the queue
   * Returns true if successful, false otherwise
   */
  pushDecisionEvent(event: XRDecisionEvent): Promise<boolean>;

  /**
   * Push a run to the queue
   */
  pushRun(run: XRRun): Promise<boolean>;

  /**
   * Push a step to the queue
   */
  pushStep(step: XRStep): Promise<boolean>;

  /**
   * Push multiple decision events (batch operation)
   * Returns count of successfully queued events
   */
  pushDecisionEvents(events: XRDecisionEvent[]): Promise<number>;
}

/**
 * In-memory queue implementation (MVP)
 * 
 * Trade-off: In-memory queue is simple but:
 * - Events are lost on restart
 * - No persistence
 * - No cross-process visibility
 * 
 * For production, implement SQS adapter:
 * - Use AWS SDK v3
 * - Send to SQS queue
 * - Handle SQS errors gracefully
 */
export class InMemoryQueue implements EventQueue {
  private decisionEvents: XRDecisionEvent[] = [];
  private runs: XRRun[] = [];
  private steps: XRStep[] = [];

  async pushDecisionEvent(event: XRDecisionEvent): Promise<boolean> {
    try {
      this.decisionEvents.push(event);
      return true;
    } catch (error) {
      return false;
    }
  }

  async pushRun(run: XRRun): Promise<boolean> {
    try {
      this.runs.push(run);
      return true;
    } catch (error) {
      return false;
    }
  }

  async pushStep(step: XRStep): Promise<boolean> {
    try {
      this.steps.push(step);
      return true;
    } catch (error) {
      return false;
    }
  }

  async pushDecisionEvents(events: XRDecisionEvent[]): Promise<number> {
    let count = 0;
    for (const event of events) {
      const success = await this.pushDecisionEvent(event);
      if (success) {
        count++;
      }
    }
    return count;
  }

  // Utility methods for testing/monitoring (not part of interface)
  getDecisionEventCount(): number {
    return this.decisionEvents.length;
  }

  getRunCount(): number {
    return this.runs.length;
  }

  getStepCount(): number {
    return this.steps.length;
  }

  clear(): void {
    this.decisionEvents = [];
    this.runs = [];
    this.steps = [];
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

      // Declare durable queues (survive broker restart)
      await this.channel.assertQueue(this.decisionQueue, { durable: true });
      await this.channel.assertQueue(this.runsQueue, { durable: true });
      await this.channel.assertQueue(this.stepsQueue, { durable: true });

      this.connection.on('error', (err: Error) => {
        console.error('RabbitMQ connection error', err);
        this.connection = null;
        this.channel = null;
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

  async pushDecisionEvent(event: XRDecisionEvent): Promise<boolean> {
    try {
      if (!(await this.ensureConnected())) return false;

      const message = Buffer.from(JSON.stringify(event));
      return this.channel.sendToQueue(
        this.decisionQueue,
        message,
        { persistent: true }
      );
    } catch (error) {
      return false;
    }
  }

  async pushRun(run: XRRun): Promise<boolean> {
    try {
      if (!(await this.ensureConnected())) return false;

      const message = Buffer.from(JSON.stringify(run));
      return this.channel.sendToQueue(
        this.runsQueue,
        message,
        { persistent: true }
      );
    } catch (error) {
      return false;
    }
  }

  async pushStep(step: XRStep): Promise<boolean> {
    try {
      if (!(await this.ensureConnected())) return false;

      const message = Buffer.from(JSON.stringify(step));
      return this.channel.sendToQueue(
        this.stepsQueue,
        message,
        { persistent: true }
      );
    } catch (error) {
      return false;
    }
  }

  async pushDecisionEvents(events: XRDecisionEvent[]): Promise<number> {
    let count = 0;
    for (const event of events) {
      if (await this.pushDecisionEvent(event)) {
        count++;
      }
    }
    return count;
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

  async pushDecisionEvent(event: XRDecisionEvent): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'decision', data: event }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async pushRun(run: XRRun): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'run', data: run }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async pushStep(step: XRStep): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'step', data: step }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async pushDecisionEvents(events: XRDecisionEvent[]): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'decisions', data: events }),
      });
      return response.ok ? events.length : 0;
    } catch (error) {
      return 0;
    }
  }
}

/**
 * Factory function to create queue instance
 * 
 * Trade-off: Environment-based selection. For production, use dependency injection
 * or configuration to select queue implementation.
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

