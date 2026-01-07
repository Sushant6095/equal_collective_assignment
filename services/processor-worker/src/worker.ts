/**
 * Processor worker - polls events and processes them
 * 
 * Responsibilities:
 * - Poll events from queue
 * - Store full payloads in S3 with deterministic keys
 * - Store aggregated metrics in ClickHouse
 * - Idempotent processing (safe retries)
 */

import {
  XRDecisionEvent,
  XRRun,
  XRStep,
} from '@xray/shared-types';
import { EventQueue, QueueMessage } from './queue';
import { ClickHouseStorage } from './clickhouse';
import { S3Storage } from './s3';
import { logger } from './logger';

export interface WorkerConfig {
  pollIntervalMs: number;
  batchSize: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  pollIntervalMs: 1000, // Poll every second
  batchSize: 10, // Process up to 10 messages per poll
};

/**
 * Processor worker
 * 
 * Design: Single-threaded worker that polls and processes events.
 * For production, consider:
 * - Multiple worker instances for parallelism
 * - Worker pools
 * - Graceful shutdown with in-flight message handling
 */
export class ProcessorWorker {
  private queue: EventQueue;
  private clickhouse: ClickHouseStorage;
  private s3: S3Storage;
  private config: WorkerConfig;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  // In-memory state for aggregation (in production, use Redis or similar)
  private runCache: Map<string, XRRun> = new Map();
  private stepCache: Map<string, XRStep> = new Map();
  private stepDecisionEvents: Map<string, XRDecisionEvent[]> = new Map();

  constructor(
    clickhouse: ClickHouseStorage,
    s3: S3Storage,
    queue: EventQueue,
    config: Partial<WorkerConfig> = {}
  ) {
    this.clickhouse = clickhouse;
    this.s3 = s3;
    this.queue = queue;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Worker already running');
      return;
    }

    this.isRunning = true;
    logger.info('Processor worker started', {
      pollInterval: this.config.pollIntervalMs,
      batchSize: this.config.batchSize,
    });

    // Start polling loop
    this.pollLoop();
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Processor worker stopped');
  }

  /**
   * Polling loop
   */
  private pollLoop(): void {
    if (!this.isRunning) {
      return;
    }

    this.processBatch()
      .catch((error) => {
        logger.error('Error in poll loop', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        // Schedule next poll
        this.pollTimer = setTimeout(() => {
          this.pollLoop();
        }, this.config.pollIntervalMs);
      });
  }

  /**
   * Process a batch of messages
   */
  private async processBatch(): Promise<void> {
    const messages = await this.queue.poll(this.config.batchSize);

    if (messages.length === 0) {
      return; // No messages to process
    }

    logger.debug('Processing batch', { count: messages.length });

    // Process each message
    for (const message of messages) {
      try {
        // Idempotency check
        if (message.messageId && await this.isProcessed(message.messageId)) {
          logger.debug('Message already processed, skipping', {
            messageId: message.messageId,
          });
          await this.queue.deleteMessage(message.messageId);
          continue;
        }

        await this.processMessage(message);

        // Acknowledge message after successful processing
        if (message.messageId) {
          await this.queue.deleteMessage(message.messageId);
        }
      } catch (error) {
        logger.error('Error processing message', {
          messageId: message.messageId,
          type: message.type,
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't acknowledge on error - let message be retried
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: QueueMessage): Promise<void> {
    switch (message.type) {
      case 'decision':
        await this.processDecisionEvent(message.data as XRDecisionEvent);
        break;
      case 'decisions':
        await this.processDecisionEvents(message.data as XRDecisionEvent[]);
        break;
      case 'run':
        await this.processRun(message.data as XRRun);
        break;
      case 'step':
        await this.processStep(message.data as XRStep);
        break;
      default:
        logger.warn('Unknown message type', { type: message.type });
    }
  }

  /**
   * Process a single decision event
   */
  private async processDecisionEvent(event: XRDecisionEvent): Promise<void> {
    logger.debug('Processing decision event', {
      eventId: event.id,
      runId: event.runId,
      stepId: event.stepId,
    });

    // Store full payload in S3 (idempotent - deterministic key)
    const s3Key = await this.s3.storeDecisionEvent(event);
    logger.debug('Decision event stored in S3', {
      eventId: event.id,
      s3Key,
    });

    // Store reference in ClickHouse (links to S3)
    const run = this.runCache.get(event.runId);
    const pipelineId = run?.pipelineId || 'unknown';
    await this.clickhouse.storeDecisionEventReference(event, s3Key, pipelineId);

    // Track event for step aggregation
    if (!this.stepDecisionEvents.has(event.stepId)) {
      this.stepDecisionEvents.set(event.stepId, []);
    }
    this.stepDecisionEvents.get(event.stepId)!.push(event);
  }

  /**
   * Process multiple decision events (batch)
   */
  private async processDecisionEvents(events: XRDecisionEvent[]): Promise<void> {
    logger.debug('Processing decision events batch', { count: events.length });

    for (const event of events) {
      await this.processDecisionEvent(event);
    }
  }

  /**
   * Process a run
   */
  private async processRun(run: XRRun): Promise<void> {
    logger.debug('Processing run', {
      runId: run.id,
      pipelineId: run.pipelineId,
      status: run.status,
    });

    // Store full payload in S3
    const s3Key = await this.s3.storeRun(run);
    logger.debug('Run stored in S3', { runId: run.id, s3Key });

    // Cache run for aggregation
    this.runCache.set(run.id, run);

    // If run is completed, calculate and store aggregated metrics
    if (run.status === 'completed' || run.status === 'failed') {
      await this.aggregateRunMetrics(run.id);
    }
  }

  /**
   * Process a step
   */
  private async processStep(step: XRStep): Promise<void> {
    logger.debug('Processing step', {
      stepId: step.id,
      type: step.type,
      name: step.name,
    });

    // Store full payload in S3
    // Need runId - try to get from cache or metadata
    const runId = (step as any).runId || 'unknown';
    const s3Key = await this.s3.storeStep(step, runId);
    logger.debug('Step stored in S3', { stepId: step.id, s3Key });

    // Cache step for aggregation
    this.stepCache.set(step.id, step);

    // If step is completed, calculate and store aggregated metrics
    if (step.completedAt) {
      await this.aggregateStepMetrics(step.id);
    }
  }

  /**
   * Aggregate step metrics and store in ClickHouse
   */
  private async aggregateStepMetrics(stepId: string): Promise<void> {
    const step = this.stepCache.get(stepId);
    if (!step) {
      logger.warn('Step not found in cache', { stepId });
      return;
    }

    const run = this.runCache.get((step as any).runId || '');
    if (!run) {
      logger.warn('Run not found in cache', {
        stepId,
        runId: (step as any).runId,
      });
      return;
    }

    const decisionEvents = this.stepDecisionEvents.get(stepId) || [];
    const metrics = this.clickhouse.calculateStepMetrics(step, run, decisionEvents);

    await this.clickhouse.storeStepMetrics(metrics);
    logger.info('Step metrics stored', {
      stepId,
      inputCount: metrics.inputCount,
      outputCount: metrics.outputCount,
      eliminationRatio: metrics.eliminationRatio,
    });
  }

  /**
   * Aggregate run metrics and store in ClickHouse
   */
  private async aggregateRunMetrics(runId: string): Promise<void> {
    const run = this.runCache.get(runId);
    if (!run) {
      logger.warn('Run not found in cache', { runId });
      return;
    }

    // Collect all step metrics for this run
    const stepMetrics: any[] = [];
    for (const [stepId, step] of this.stepCache.entries()) {
      if ((step as any).runId === runId) {
        const decisionEvents = this.stepDecisionEvents.get(stepId) || [];
        const metrics = this.clickhouse.calculateStepMetrics(step, run, decisionEvents);
        stepMetrics.push(metrics);
      }
    }

    const runMetrics = this.clickhouse.calculateRunMetrics(run, stepMetrics);
    await this.clickhouse.storeRunMetrics(runMetrics);
    logger.info('Run metrics stored', {
      runId,
      totalSteps: runMetrics.totalSteps,
      totalInputCount: runMetrics.totalInputCount,
      totalOutputCount: runMetrics.totalOutputCount,
      overallEliminationRatio: runMetrics.overallEliminationRatio,
    });
  }

  /**
   * Check if message was already processed (idempotency)
   * 
   * Trade-off: Simple in-memory check. For production, use Redis or database
   * for distributed idempotency tracking.
   */
  private async isProcessed(messageId: string): Promise<boolean> {
    // In production, check Redis/database
    return false; // For MVP, always process
  }
}

