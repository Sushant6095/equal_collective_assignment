/**
 * ClickHouse client for storing aggregated analytics
 * 
 * Design: Stores aggregated metrics (not raw events) for fast analytics queries.
 * Raw events are stored in S3 for full traceability.
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';
import { XRRun, XRStep, XRDecisionEvent, XRDecisionOutcome } from '@xray/shared-types';

export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface StepMetrics {
  stepId: string;
  runId: string;
  pipelineId: string;
  stepType: string;
  stepName: string;
  inputCount: number;
  outputCount: number;
  eliminationRatio: number; // outputCount / inputCount
  keptCount: number;
  eliminatedCount: number;
  scoredCount: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface RunMetrics {
  runId: string;
  pipelineId: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  totalSteps: number;
  totalInputCount: number;
  totalOutputCount: number;
  overallEliminationRatio: number;
}

/**
 * ClickHouse client - stores aggregated metrics, not raw events. Raw events go to S3.
 */
export class ClickHouseStorage {
  private client: ClickHouseClient;
  private database: string;

  constructor(config: ClickHouseConfig) {
    this.database = config.database;
    
    // Build connection config - completely omit password if empty
    // ClickHouse client has issues with empty string passwords
    // Aiven ClickHouse uses HTTPS (ports > 20000 or 443/8443)
    const protocol = config.port === 443 || config.port === 8443 || config.port > 20000 ? 'https' : 'http';
    
    const clientConfig: {
      host: string;
      username: string;
      database: string;
      password?: string;
    } = {
      host: `${protocol}://${config.host}:${config.port}`,
      username: config.user,
      database: this.database,
    };
    
    // Only add password property if it's actually provided and not empty
    // Omitting the field entirely works better than empty string
    const password = config.password?.trim();
    if (password && password.length > 0) {
      clientConfig.password = password;
    }
    
    this.client = createClient(clientConfig);
  }

  /**
   * Initialize database and tables
   * 
   * Idempotent: Safe to call multiple times (uses IF NOT EXISTS)
   */
  async initialize(): Promise<void> {
    // Create database if it doesn't exist
    await this.client.exec({ query: `CREATE DATABASE IF NOT EXISTS ${this.database}` });

    // Create runs table for aggregated run metrics
    await this.client.exec({ query: `
      CREATE TABLE IF NOT EXISTS ${this.database}.runs (
        run_id String,
        pipeline_id String,
        status String,
        started_at DateTime64(3),
        completed_at Nullable(DateTime64(3)),
        error Nullable(String),
        total_steps UInt32,
        total_input_count UInt64,
        total_output_count UInt64,
        overall_elimination_ratio Float64,
        metadata String,
        updated_at DateTime64(3) DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (run_id)
      PARTITION BY toYYYYMM(started_at)
    ` });

    // Create steps table for aggregated step metrics
    await this.client.exec({ query: `
      CREATE TABLE IF NOT EXISTS ${this.database}.steps (
        step_id String,
        run_id String,
        pipeline_id String,
        step_type String,
        step_name String,
        input_count UInt64,
        output_count UInt64,
        elimination_ratio Float64,
        kept_count UInt64,
        eliminated_count UInt64,
        scored_count UInt64,
        started_at DateTime64(3),
        completed_at Nullable(DateTime64(3)),
        updated_at DateTime64(3) DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (step_id, run_id)
      PARTITION BY toYYYYMM(started_at)
    ` });

    // Create decision_events table for decision-level analytics
    // Note: This stores decision events but in aggregated form (not full payloads)
    await this.client.exec({ query: `
      CREATE TABLE IF NOT EXISTS ${this.database}.decision_events (
        event_id String,
        step_id String,
        run_id String,
        pipeline_id String,
        outcome String,
        item_id String,
        score Nullable(Float64),
        timestamp DateTime64(3),
        s3_key String,
        updated_at DateTime64(3) DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (run_id, step_id, timestamp)
      PARTITION BY toYYYYMM(timestamp)
    ` });
  }

  /**
   * Store or update run metrics
   * 
   * Idempotent: Uses ReplacingMergeTree, so duplicate inserts are safe.
   * The engine will keep the latest version based on updated_at.
   */
  async storeRunMetrics(metrics: RunMetrics): Promise<void> {
    await this.client.insert({
      table: `${this.database}.runs`,
      values: [
        {
          run_id: metrics.runId,
          pipeline_id: metrics.pipelineId,
          status: metrics.status,
          started_at: (metrics.startedAt instanceof Date ? metrics.startedAt : new Date(metrics.startedAt)).toISOString().replace('T', ' ').replace('Z', ''),
          completed_at: metrics.completedAt
            ? (metrics.completedAt instanceof Date ? metrics.completedAt : new Date(metrics.completedAt)).toISOString().replace('T', ' ').replace('Z', '')
            : null,
          error: metrics.error,
          total_steps: metrics.totalSteps,
          total_input_count: metrics.totalInputCount,
          total_output_count: metrics.totalOutputCount,
          overall_elimination_ratio: metrics.overallEliminationRatio,
          metadata: JSON.stringify({}),
          updated_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  /**
   * Store or update step metrics
   * 
   * Idempotent: Safe to retry - ReplacingMergeTree handles duplicates.
   */
  async storeStepMetrics(metrics: StepMetrics): Promise<void> {
    await this.client.insert({
      table: `${this.database}.steps`,
      values: [
        {
          step_id: metrics.stepId,
          run_id: metrics.runId,
          pipeline_id: metrics.pipelineId,
          step_type: metrics.stepType,
          step_name: metrics.stepName,
          input_count: metrics.inputCount,
          output_count: metrics.outputCount,
          elimination_ratio: metrics.eliminationRatio,
          kept_count: metrics.keptCount,
          eliminated_count: metrics.eliminatedCount,
          scored_count: metrics.scoredCount,
          started_at: (metrics.startedAt instanceof Date ? metrics.startedAt : new Date(metrics.startedAt)).toISOString().replace('T', ' ').replace('Z', ''),
          completed_at: metrics.completedAt
            ? (metrics.completedAt instanceof Date ? metrics.completedAt : new Date(metrics.completedAt)).toISOString().replace('T', ' ').replace('Z', '')
            : null,
          updated_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  /**
   * Store decision event reference (links to S3 for full payload)
   * 
   * Idempotent: Safe to retry.
   */
  async storeDecisionEventReference(
    event: XRDecisionEvent,
    s3Key: string,
    pipelineId: string
  ): Promise<void> {
    await this.client.insert({
      table: `${this.database}.decision_events`,
      values: [
        {
          event_id: event.id,
          step_id: event.stepId,
          run_id: event.runId,
          pipeline_id: pipelineId,
          outcome: event.outcome,
          item_id: event.itemId,
          score: event.score ?? null,
          timestamp: (event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp)).toISOString().replace('T', ' ').replace('Z', ''),
          s3_key: s3Key,
          updated_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  /**
   * Calculate step metrics from decision events
   * 
   * Helper function to aggregate decision events into step metrics.
   */
  calculateStepMetrics(
    step: XRStep,
    run: XRRun,
    decisionEvents: XRDecisionEvent[]
  ): StepMetrics {
    // Try to get input/output counts from step config first (most reliable)
    let inputCount = 0;
    let outputCount = 0;
    
    if (step.config && typeof step.config === 'object') {
      const config = step.config as any;
      inputCount = config.inputCount || config.input_count || 0;
      outputCount = config.outputCount || config.output_count || 0;
    }
    
    // If not in config, try to get from decision events metadata
    if (inputCount === 0 && decisionEvents.length > 0) {
      inputCount = (decisionEvents[0].metadata?.inputCount as number) || 
                   (decisionEvents[0].metadata?.input_count as number) || 0;
    }
    
    // If still 0, estimate from decision events (but this is not accurate)
    // For accurate metrics, step config should include inputCount
    if (inputCount === 0 && decisionEvents.length > 0) {
      // Estimate: if we have decision events, input is at least that many
      // But we don't know the actual input count, so we'll use a conservative estimate
      inputCount = decisionEvents.length;
    }
    
    // If outputCount not in config, calculate from decision events
    if (outputCount === 0) {

    // Calculate counts from decision events
    const keptCount = decisionEvents.filter(
      (e) => e.outcome === XRDecisionOutcome.KEPT
    ).length;
    const eliminatedCount = decisionEvents.filter(
      (e) => e.outcome === XRDecisionOutcome.ELIMINATED
    ).length;
    const scoredCount = decisionEvents.filter(
      (e) => e.outcome === XRDecisionOutcome.SCORED
    ).length;
    
    // If outputCount not in config, calculate from decision events
    // Output count = kept + scored (items that passed through)
    if (outputCount === 0) {
      outputCount = keptCount + scoredCount;
    }

    const eliminationRatio =
      inputCount > 0 ? 1 - outputCount / inputCount : 0;

    return {
      stepId: step.id,
      runId: run.id,
      pipelineId: run.pipelineId,
      stepType: step.type,
      stepName: step.name,
      inputCount,
      outputCount,
      eliminationRatio,
      keptCount,
      eliminatedCount,
      scoredCount,
      startedAt: step.startedAt instanceof Date ? step.startedAt : new Date(step.startedAt),
      completedAt: step.completedAt ? (step.completedAt instanceof Date ? step.completedAt : new Date(step.completedAt)) : null,
    };
  }

  /**
   * Calculate run metrics from steps
   */
  calculateRunMetrics(
    run: XRRun,
    stepMetrics: StepMetrics[]
  ): RunMetrics {
    const totalSteps = stepMetrics.length;
    const totalInputCount = stepMetrics.reduce((sum, s) => sum + s.inputCount, 0);
    const totalOutputCount = stepMetrics.reduce((sum, s) => sum + s.outputCount, 0);
    const overallEliminationRatio =
      totalInputCount > 0 ? 1 - totalOutputCount / totalInputCount : 0;

    return {
      runId: run.id,
      pipelineId: run.pipelineId,
      status: run.status,
      startedAt: run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt),
      completedAt: run.completedAt ? (run.completedAt instanceof Date ? run.completedAt : new Date(run.completedAt)) : null,
      error: run.error,
      totalSteps,
      totalInputCount,
      totalOutputCount,
      overallEliminationRatio,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

