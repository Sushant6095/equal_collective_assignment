/**
 * X-Ray SDK - Main entry point for decision observability
 * 
 * Design trade-offs:
 * - Non-blocking: All operations are fire-and-forget to never block application logic
 * - Automatic metrics: Captures input/output counts without requiring explicit calls
 * - Adaptive sampling: Reduces data volume while maintaining observability
 * - Silent failures: SDK failures never affect application execution
 */

import { v4 as uuidv4 } from 'uuid';
import {
  XRRun,
  XRStep,
  XRDecisionEvent,
  XRStepType,
  XRDecisionOutcome,
  XRRunStatus,
} from '@xray/shared-types';
import { CaptureLevel, AdaptiveSampler } from './sampler';
import { EventBuffer } from './buffer';
import { HttpTransport } from './transport';

export interface XRayConfig {
  apiUrl?: string;
  captureLevel?: CaptureLevel;
  bufferConfig?: {
    maxSize?: number;
    flushIntervalMs?: number;
    batchSize?: number;
  };
}

/**
 * X-Ray SDK for tracking decisions in multi-step pipelines
 * 
 * Usage:
 *   const xray = new XRay({ apiUrl: 'http://localhost:3000' });
 *   const runId = await xray.startRun('pipeline-1', input);
 *   const result = await xray.step(runId, XRStepType.FILTER, 'filter-step', async () => {
 *     // business logic
 *     return processedItems;
 *   });
 *   await xray.endRun(runId, result);
 */
export class XRay {
  private activeRuns: Map<string, XRRun> = new Map();
  private activeSteps: Map<string, XRStep> = new Map();
  private sampler: AdaptiveSampler;
  private buffer: EventBuffer;
  private transport: HttpTransport;
  private captureLevel: CaptureLevel;

  constructor(config: XRayConfig = {}) {
    this.captureLevel = config.captureLevel || CaptureLevel.SAMPLED;
    this.sampler = new AdaptiveSampler();
    this.transport = new HttpTransport({ apiUrl: config.apiUrl });

    // Initialize buffer with transport callback
    // Trade-off: Buffer handles batching, transport handles HTTP.
    // This separation allows us to swap transports (e.g., to file, queue) without changing buffer logic.
    this.buffer = new EventBuffer(
      (events) => this.transport.sendDecisionEvents(events),
      config.bufferConfig
    );
  }

  /**
   * Start a new pipeline run
   * 
   * Trade-off: We store runs in memory. For production, consider persisting
   * to a database for durability and cross-process visibility.
   */
  async startRun(
    pipelineId: string,
    input: unknown,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const runId = uuidv4();
    const run: XRRun = {
      id: runId,
      pipelineId,
      status: XRRunStatus.RUNNING,
      input,
      output: null,
      startedAt: new Date(),
      completedAt: null,
      error: null,
      metadata,
    };

    this.activeRuns.set(runId, run);

    // Send run metadata asynchronously (non-blocking)
    this.transport.sendRun(run).catch(() => {
      // Silent failure
    });

    return runId;
  }

  /**
   * Execute a step and automatically capture decisions
   * 
   * This method wraps business logic execution and automatically:
   * - Tracks input/output counts
   * - Captures decision events based on capture level
   * - Samples events if needed
   * - Buffers events for batch sending
   * 
   * Trade-off: We require the business logic to return an array of items
   * with decision metadata. This is a design constraint that ensures we can
   * track individual item decisions. Alternative: Could accept a callback that
   * explicitly reports decisions, but that's more verbose.
   * 
   * @param runId - The run this step belongs to
   * @param stepType - Type of step (filter, rank, llm, transform)
   * @param stepName - Human-readable step name
   * @param businessLogic - Async function that executes the step logic and returns items with decisions
   * @param input - Input to the business logic
   * @param config - Optional step configuration
   * @returns The result of businessLogic execution
   */
  async step<TInput, TOutput extends Array<{
    itemId: string;
    outcome: XRDecisionOutcome;
    input: unknown;
    output: unknown;
    reason: string;
    score?: number;
  }>>(
    runId: string,
    stepType: XRStepType,
    stepName: string,
    businessLogic: (input: TInput) => Promise<TOutput>,
    input: TInput,
    config?: Record<string, unknown>
  ): Promise<TOutput> {
    const stepId = uuidv4();
    const step: XRStep = {
      id: stepId,
      type: stepType,
      name: stepName,
      config,
      startedAt: new Date(),
      completedAt: null,
    };

    this.activeSteps.set(stepId, step);

    // Send step metadata asynchronously
    this.transport.sendStep(step).catch(() => {
      // Silent failure
    });

    try {
      // Execute business logic
      // Trade-off: We execute synchronously here, but all observability
      // operations (buffering, transport) are async and non-blocking.
      const output = await businessLogic(input);

      // Automatically capture metrics and decisions
      this.captureStepMetrics(runId, stepId, input, output);

      // Mark step as completed
      step.completedAt = new Date();
      this.transport.sendStep(step).catch(() => {
        // Silent failure
      });

      return output;
    } catch (error) {
      // Mark step as failed
      step.completedAt = new Date();
      this.transport.sendStep(step).catch(() => {
        // Silent failure
      });

      // Re-throw to allow application to handle the error
      // Trade-off: We don't swallow business logic errors, only SDK errors
      throw error;
    } finally {
      this.activeSteps.delete(stepId);
    }
  }

  /**
   * Capture step metrics and decision events
   * 
   * Trade-off: We infer decisions from the output array structure.
   * This requires the business logic to return items with decision metadata.
   * Alternative: Pass a separate decisions array, but that's more verbose.
   */
  private captureStepMetrics(
    runId: string,
    stepId: string,
    input: unknown,
    output: Array<{
      itemId: string;
      outcome: XRDecisionOutcome;
      input: unknown;
      output: unknown;
      reason: string;
      score?: number;
    }>
  ): void {
    // Always capture input/output counts (even in metrics_only mode)
    const inputCount = Array.isArray(input) ? input.length : 1;
    const outputCount = output.length;

    // Determine what to capture based on capture level
    if (this.captureLevel === CaptureLevel.METRICS_ONLY) {
      // Only send metrics, no decision events
      // Trade-off: We could send a single "step metrics" event here,
      // but for simplicity, we rely on step metadata for metrics.
      return;
    }

    // For SAMPLED and FULL, capture decision events
    const shouldSample = this.captureLevel === CaptureLevel.SAMPLED;
    const targetSampleSize = shouldSample
      ? this.sampler.calculateTargetSampleSize(outputCount)
      : outputCount;

    // Capture decision events
    output.forEach((item, index) => {
      const shouldCapture = !shouldSample || this.sampler.shouldSample(index, outputCount, targetSampleSize);

      if (shouldCapture) {
        const event: XRDecisionEvent = {
          id: uuidv4(),
          stepId,
          runId,
          outcome: item.outcome,
          itemId: item.itemId,
          input: item.input,
          output: item.output,
          reason: item.reason,
          score: item.score,
          metadata: {
            inputCount,
            outputCount,
            sampled: shouldSample && index > 0 && index < outputCount - 1,
          },
          timestamp: new Date(),
        };

        // Add to buffer (non-blocking)
        this.buffer.add(event);
      }
    });
  }

  /**
   * End a pipeline run
   * 
   * Trade-off: We finalize the run synchronously here, but the HTTP send
   * is still async and non-blocking. For production, consider awaiting
   * a final buffer flush to ensure all events are sent before marking complete.
   */
  async endRun(runId: string, output?: unknown, error?: Error): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) {
      return; // Run not found - silently fail
    }

    run.status = error ? XRRunStatus.FAILED : XRRunStatus.COMPLETED;
    run.completedAt = new Date();
    run.output = output ?? null;
    run.error = error ? error.message : null;

    // Send updated run metadata (non-blocking)
    this.transport.sendRun(run).catch(() => {
      // Silent failure
    });

    this.activeRuns.delete(runId);
  }

  /**
   * Force flush all buffered events (useful for graceful shutdown)
   * 
   * Trade-off: This is the only potentially blocking operation in the SDK.
   * It's acceptable because it's only called during shutdown.
   */
  async flush(): Promise<void> {
    await this.buffer.forceFlush();
  }

  /**
   * Get current buffer size (for monitoring)
   */
  getBufferSize(): number {
    return this.buffer.getSize();
  }
}

