/**
 * API client for query API
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_QUERY_API_URL || 'http://localhost:3001';

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

export interface RunDetail {
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
  steps: StepListItem[];
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
}

export interface StepDetail {
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
  decisionEvents: DecisionEventReference[];
}

/**
 * Fetch runs list
 */
export async function fetchRuns(badFilter: boolean = false): Promise<RunListItem[]> {
  const url = `${API_BASE_URL}/runs${badFilter ? '?bad_filter=true' : ''}`;
  const response = await fetch(url, { cache: 'no-store' });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch runs: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.data || [];
}

/**
 * Fetch run details
 */
export async function fetchRun(runId: string): Promise<RunDetail> {
  const url = `${API_BASE_URL}/runs/${runId}`;
  const response = await fetch(url, { cache: 'no-store' });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch run: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.data;
}

/**
 * Fetch step details
 */
export async function fetchStep(stepId: string): Promise<StepDetail> {
  const url = `${API_BASE_URL}/steps/${stepId}/details`;
  const response = await fetch(url, { cache: 'no-store' });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch step: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.data;
}

