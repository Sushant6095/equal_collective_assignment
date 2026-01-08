/**
 * Response type definitions
 * 
 * Clear response shapes for API endpoints
 */

export interface RunListItem {
  id: string;
  pipelineId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  metrics: {
    totalSteps: number;
    totalInputCount: number;
    totalOutputCount: number;
    overallEliminationRatio: number;
  };
}

export interface RunDetail extends RunListItem {
  steps: StepListItem[];
  rawPayload?: unknown; // Full run payload from S3 (optional)
}

export interface StepListItem {
  id: string;
  runId: string;
  pipelineId: string;
  type: string;
  name: string;
  startedAt: string;
  completedAt: string | null;
  metrics: {
    inputCount: number;
    outputCount: number;
    eliminationRatio: number;
    keptCount: number;
    eliminatedCount: number;
    scoredCount: number;
  };
}

export interface StepDetail extends StepListItem {
  decisionEvents: DecisionEventReference[];
  rawPayload?: unknown; // Full step payload from S3 (optional)
}

export interface DecisionEventReference {
  id: string;
  stepId: string;
  runId: string;
  outcome: string;
  itemId: string;
  score: number | null;
  timestamp: string;
  s3Key: string;
  rawPayload?: unknown; // Full decision event payload from S3 (optional)
}






