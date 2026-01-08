/**
 * Validation logic for X-Ray events
 * 
 * Clean separation: Validation is isolated from HTTP and queue logic.
 * This allows us to reuse validation in other contexts (e.g., CLI tools, tests).
 */

import { z } from 'zod';
import {
  XRDecisionEvent,
  XRDecisionOutcome,
  XRRun,
  XRStep,
  XRStepType,
  XRRunStatus,
} from '@xray/shared-types';

/**
 * Schema for validating XRDecisionEvent
 * 
 * Trade-off: We use Zod for runtime validation. This provides type safety
 * and clear error messages. Alternative: Use TypeScript's type system only,
 * but that doesn't validate at runtime (malformed JSON would pass).
 */
const DecisionEventSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  runId: z.string().min(1),
  outcome: z.nativeEnum(XRDecisionOutcome),
  itemId: z.string().min(1),
  input: z.unknown(),
  output: z.unknown(),
  reason: z.string().min(1),
  score: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.union([z.string(), z.date()]).transform((val) => {
    // Handle both string and Date formats
    return val instanceof Date ? val : new Date(val);
  }),
});

/**
 * Schema for validating XRRun
 */
const RunSchema = z.object({
  id: z.string().min(1),
  pipelineId: z.string().min(1),
  status: z.nativeEnum(XRRunStatus),
  input: z.unknown(),
  output: z.unknown().nullable(),
  startedAt: z.union([z.string(), z.date()]).transform((val) => {
    return val instanceof Date ? val : new Date(val);
  }),
  completedAt: z
    .union([z.string(), z.date()])
    .nullable()
    .transform((val) => {
      if (val === null) return null;
      return val instanceof Date ? val : new Date(val);
    }),
  error: z.string().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Schema for validating XRStep
 */
const StepSchema = z.object({
  id: z.string().min(1),
  type: z.nativeEnum(XRStepType),
  name: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  startedAt: z.union([z.string(), z.date()]).transform((val) => {
    return val instanceof Date ? val : new Date(val);
  }),
  completedAt: z
    .union([z.string(), z.date()])
    .nullable()
    .transform((val) => {
      if (val === null) return null;
      return val instanceof Date ? val : new Date(val);
    }),
});

/**
 * Validation result type
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: z.ZodError;
}

/**
 * Validate a decision event
 * 
 * Trade-off: We return a result object rather than throwing.
 * This allows the HTTP layer to handle validation errors gracefully
 * without try/catch blocks.
 */
export function validateDecisionEvent(
  data: unknown
): ValidationResult<XRDecisionEvent> {
  try {
    const parsed = DecisionEventSchema.parse(data);
    return {
      success: true,
      data: parsed as XRDecisionEvent,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Validation failed',
        details: error,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/**
 * Validate a run
 */
export function validateRun(data: unknown): ValidationResult<XRRun> {
  try {
    const parsed = RunSchema.parse(data);
    return {
      success: true,
      data: parsed as XRRun,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Validation failed',
        details: error,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/**
 * Validate a step
 */
export function validateStep(data: unknown): ValidationResult<XRStep> {
  try {
    const parsed = StepSchema.parse(data);
    return {
      success: true,
      data: parsed as XRStep,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Validation failed',
        details: error,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

/**
 * Validate an array of decision events (for batch ingestion)
 */
export function validateDecisionEvents(
  data: unknown
): ValidationResult<XRDecisionEvent[]> {
  if (!Array.isArray(data)) {
    return {
      success: false,
      error: 'Expected array of decision events',
    };
  }

  const results: XRDecisionEvent[] = [];
  const errors: string[] = [];

  for (let i = 0; i < data.length; i++) {
    const result = validateDecisionEvent(data[i]);
    if (result.success && result.data) {
      results.push(result.data);
    } else {
      errors.push(`Event ${i}: ${result.error || 'Unknown error'}`);
    }
  }

  // Return partial success if some events are valid
  // Trade-off: We accept partial batches. Alternative: Reject entire batch
  // if any event is invalid, but that's less resilient.
  if (results.length === 0) {
    return {
      success: false,
      error: `All events invalid: ${errors.join('; ')}`,
    };
  }

  return {
    success: true,
    data: results,
    error: errors.length > 0 ? `Some events invalid: ${errors.join('; ')}` : undefined,
  };
}

