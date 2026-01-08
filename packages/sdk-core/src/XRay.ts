/**
 * X-Ray SDK - tracks decisions in pipelines
 * 
 * Non-blocking, automatic metrics, adaptive sampling. Never throws errors.
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
 * Optional callback to provide custom decision context
 */
export interface DecisionCallback<TInput, TOutput> {
  (item: TInput, result: TOutput, index: number): {
    outcome: XRDecisionOutcome;
    reason: string;
    score?: number;
  } | null; // Return null to skip tracking this item
}

/**
 * X-Ray SDK - wrap your existing pipeline code, no refactoring needed
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

    // Buffer batches events, transport sends them - can swap transports easily
    this.buffer = new EventBuffer(
      (events) => this.transport.sendDecisionEvents(events),
      config.bufferConfig
    );
  }

  /**
   * Start a new pipeline run. Stored in memory for now.
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
   * LIGHTWEIGHT WRAPPER: Works with existing code without requiring refactoring.
   * 
   * This method automatically:
   * - Tracks input/output counts
   * - Detects which items were kept/eliminated/scored by comparing input vs output
   * - Captures decision events based on capture level
   * - Samples events if needed
   * - Buffers events for batch sending
   * 
   * @param runId - The run this step belongs to
   * @param stepType - Type of step (filter, rank, llm, transform)
   * @param stepName - Human-readable step name
   * @param businessLogic - Your existing business logic function (no changes needed!)
   * @param input - Input to the business logic
   * @param config - Optional step configuration (filters applied, thresholds, etc.)
   * @param decisionCallback - Optional callback for custom decision reporting
   * @returns The result of businessLogic execution
   */
  async step<TInput extends Array<any>, TOutput extends Array<any>>(
    runId: string,
    stepType: XRStepType,
    stepName: string,
    businessLogic: (input: TInput) => Promise<TOutput>,
    input: TInput,
    config?: Record<string, unknown>,
    decisionCallback?: DecisionCallback<TInput[number], TOutput[number]>
  ): Promise<TOutput>;

  async step<TInput, TOutput>(
    runId: string,
    stepType: XRStepType,
    stepName: string,
    businessLogic: (input: TInput) => Promise<TOutput>,
    input: TInput,
    config?: Record<string, unknown>,
    decisionCallback?: DecisionCallback<TInput, TOutput>
  ): Promise<TOutput>;

  async step<TInput, TOutput>(
    runId: string,
    stepType: XRStepType,
    stepName: string,
    businessLogic: (input: TInput) => Promise<TOutput>,
    input: TInput,
    config?: Record<string, unknown>,
    decisionCallback?: DecisionCallback<any, any>
  ): Promise<TOutput> {
    const stepId = uuidv4();
    const step: XRStep = {
      id: stepId,
      type: stepType,
      name: stepName,
      config, // Captures filters applied, thresholds, etc.
      startedAt: new Date(),
      completedAt: null,
    };

    this.activeSteps.set(stepId, step);

    // Send step metadata asynchronously
    this.transport.sendStep(step).catch(() => {
      // Silent failure
    });

    try {
      // Execute business logic (your existing code - no changes!)
      const output = await businessLogic(input);

      // Automatically capture metrics and decisions
      this.captureStepMetrics(runId, stepId, input, output, stepType, config, decisionCallback);

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
   * Capture step metrics and decision events automatically
   * 
   * AUTOMATIC CAPTURE: Detects decisions by comparing input vs output.
   * No manual decision object construction required.
   */
  private captureStepMetrics<TInput, TOutput>(
    runId: string,
    stepId: string,
    input: TInput,
    output: TOutput,
    stepType: XRStepType,
    config?: Record<string, unknown>,
    decisionCallback?: DecisionCallback<any, any>
  ): void {
    // Always capture input/output counts
    const inputCount = Array.isArray(input) ? input.length : 1;
    const outputCount = Array.isArray(output) ? output.length : 1;

    // Determine what to capture based on capture level
    if (this.captureLevel === CaptureLevel.METRICS_ONLY) {
      // Only send metrics, no decision events
      return;
    }

    // For SAMPLED and FULL, capture decision events
    const shouldSample = this.captureLevel === CaptureLevel.SAMPLED;

    // Automatic decision detection for array inputs/outputs
    if (Array.isArray(input) && Array.isArray(output)) {
      // Create a map of output items by ID for fast lookup
      const outputMap = new Map();
      const outputById = new Map();
      
      // Try to identify items by common ID fields
      output.forEach((item, index) => {
        if (item && typeof item === 'object') {
          const id = (item as any).id || (item as any).itemId || (item as any).key || `item-${index}`;
          outputMap.set(id, item);
          outputById.set(id, index);
        }
      });

      // Process each input item
      input.forEach((inputItem, inputIndex) => {
        let itemId: string;
        let outputItem: any = null;
        let outcome: XRDecisionOutcome;
        let reason: string;
        let score: number | undefined;

        // Try to get item ID from common fields
        if (inputItem && typeof inputItem === 'object') {
          itemId = (inputItem as any).id || (inputItem as any).itemId || (inputItem as any).key || `item-${inputIndex}`;
          
          // Check if item exists in output
          outputItem = outputMap.get(itemId);
          
          // If not found by ID, try to find by reference equality
          if (!outputItem) {
            const outputIndex = output.findIndex(item => item === inputItem);
            if (outputIndex >= 0) {
              outputItem = output[outputIndex];
            }
          }
        } else {
          itemId = `item-${inputIndex}`;
          // For primitive types, check if value exists in output
          outputItem = output.includes(inputItem) ? inputItem : null;
        }

        // Use custom callback if provided
        if (decisionCallback) {
          const decision = decisionCallback(inputItem, outputItem, inputIndex);
          if (decision) {
            outcome = decision.outcome;
            reason = decision.reason;
            score = decision.score;
          } else {
            // Callback returned null, skip this item
            return;
          }
        } else {
          // Automatic decision detection
          if (outputItem !== null && outputItem !== undefined) {
            // Item was kept or modified
            if (stepType === XRStepType.RANK || stepType === XRStepType.SCORE) {
              outcome = XRDecisionOutcome.SCORED;
              score = (outputItem as any)?.score || (outputItem as any)?.relevanceScore;
              reason = `Item scored: ${score !== undefined ? score : 'N/A'}`;
            } else {
              outcome = XRDecisionOutcome.KEPT;
              reason = `Item passed ${stepType} step`;
            }
          } else {
            // Item was eliminated
            outcome = XRDecisionOutcome.ELIMINATED;
            reason = `Item eliminated by ${stepType} step`;
            
            // Try to extract reason from config
            if (config) {
              if (config.threshold && (inputItem as any)?.score !== undefined) {
                reason = `Score ${(inputItem as any).score} below threshold ${config.threshold}`;
              } else if (config.matchType) {
                reason = `Item did not match ${config.matchType} criteria`;
              }
            }
          }
        }

        // Determine if we should capture this event
        const shouldCapture = !shouldSample || this.sampler.shouldSample(
          inputIndex,
          inputCount,
          this.sampler.calculateTargetSampleSize(inputCount)
        );

        if (shouldCapture) {
          const event: XRDecisionEvent = {
            id: uuidv4(),
            stepId,
            runId,
            outcome,
            itemId,
            input: inputItem,
            output: outputItem,
            reason,
            score,
            metadata: {
              inputCount,
              outputCount,
              sampled: shouldSample && inputIndex > 0 && inputIndex < inputCount - 1,
              stepType,
              filtersApplied: config, // Automatically captures filters applied
            },
            timestamp: new Date(),
          };

          // Add to buffer (non-blocking)
          this.buffer.add(event);
        }
      });
    } else {
      // For non-array inputs/outputs, create a single decision event
      const itemId = 'single-item';
      const outcome = output !== null && output !== undefined 
        ? XRDecisionOutcome.KEPT 
        : XRDecisionOutcome.ELIMINATED;
      const reason = outcome === XRDecisionOutcome.KEPT
        ? `Step completed successfully`
        : `Step eliminated item`;

      if (!shouldSample || this.sampler.shouldSample(0, 1, 1)) {
        const event: XRDecisionEvent = {
          id: uuidv4(),
          stepId,
          runId,
          outcome,
          itemId,
          input,
          output,
          reason,
          metadata: {
            inputCount,
            outputCount,
            stepType,
            filtersApplied: config,
          },
          timestamp: new Date(),
        };

        this.buffer.add(event);
      }
    }
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
