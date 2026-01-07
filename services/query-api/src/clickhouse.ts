/**
 * ClickHouse query client
 * 
 * Design: Explicit SQL queries, no joins across large tables.
 * Each query is optimized for its specific use case.
 */

import { createClient, ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RunRow {
  run_id: string;
  pipeline_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  total_steps: number;
  total_input_count: number;
  total_output_count: number;
  overall_elimination_ratio: number;
  metadata: string;
}

export interface StepRow {
  step_id: string;
  run_id: string;
  pipeline_id: string;
  step_type: string;
  step_name: string;
  input_count: number;
  output_count: number;
  elimination_ratio: number;
  kept_count: number;
  eliminated_count: number;
  scored_count: number;
  started_at: string;
  completed_at: string | null;
}

export interface DecisionEventRow {
  event_id: string;
  step_id: string;
  run_id: string;
  pipeline_id: string;
  outcome: string;
  item_id: string;
  score: number | null;
  timestamp: string;
  s3_key: string;
}

/**
 * ClickHouse query client
 * 
 * Trade-off: Explicit SQL queries for clarity and control.
 * No ORM abstraction - direct SQL for performance and transparency.
 */
export class ClickHouseQuery {
  private client: ClickHouseClient;
  private database: string;

  constructor(config: ClickHouseConfig) {
    this.database = config.database;
    this.client = createClient({
      host: `http://${config.host}:${config.port}`,
      username: config.user,
      password: config.password,
      database: this.database,
    });
  }

  /**
   * Query runs with optional filter for "bad" runs
   * 
   * Bad filter criteria:
   * - High elimination ratio (> 0.8)
   * - Failed status
   * - Has error
   * 
   * Trade-off: Single query with WHERE clause. No joins needed
   * since all data is in the runs table.
   */
  async queryRuns(
    badFilter: boolean = false,
    limit: number = 100,
    offset: number = 0
  ): Promise<RunRow[]> {
    let query = `
      SELECT
        run_id,
        pipeline_id,
        status,
        started_at,
        completed_at,
        error,
        total_steps,
        total_input_count,
        total_output_count,
        overall_elimination_ratio,
        metadata
      FROM ${this.database}.runs
      FINAL
    `;

    const conditions: string[] = [];

    if (badFilter) {
      conditions.push(
        `(overall_elimination_ratio > 0.8 OR status = 'failed' OR error IS NOT NULL)`
      );
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY started_at DESC LIMIT {limit:UInt64} OFFSET {offset:UInt64}`;

    const result = await this.client.query({
      query,
      query_params: { limit, offset },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as RunRow[];
    return rows;
  }

  /**
   * Get a specific run by ID
   * 
   * Trade-off: Direct lookup by primary key (run_id).
   * FINAL ensures we get the latest version from ReplacingMergeTree.
   */
  async getRunById(runId: string): Promise<RunRow | null> {
    const result = await this.client.query({
      query: `
        SELECT
          run_id,
          pipeline_id,
          status,
          started_at,
          completed_at,
          error,
          total_steps,
          total_input_count,
          total_output_count,
          overall_elimination_ratio,
          metadata
        FROM ${this.database}.runs
        FINAL
        WHERE run_id = {runId:String}
        LIMIT 1
      `,
      query_params: { runId },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as RunRow[];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get steps for a run
   * 
   * Trade-off: Query steps table directly, no join with runs.
   * Run ID is already in steps table, so no join needed.
   */
  async getStepsByRunId(runId: string): Promise<StepRow[]> {
    const result = await this.client.query({
      query: `
        SELECT
          step_id,
          run_id,
          pipeline_id,
          step_type,
          step_name,
          input_count,
          output_count,
          elimination_ratio,
          kept_count,
          eliminated_count,
          scored_count,
          started_at,
          completed_at
        FROM ${this.database}.steps
        FINAL
        WHERE run_id = {runId:String}
        ORDER BY started_at ASC
      `,
      query_params: { runId },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as StepRow[];
    return rows;
  }

  /**
   * Get a specific step by ID
   * 
   * Trade-off: Direct lookup, no joins.
   */
  async getStepById(stepId: string): Promise<StepRow | null> {
    const result = await this.client.query({
      query: `
        SELECT
          step_id,
          run_id,
          pipeline_id,
          step_type,
          step_name,
          input_count,
          output_count,
          elimination_ratio,
          kept_count,
          eliminated_count,
          scored_count,
          started_at,
          completed_at
        FROM ${this.database}.steps
        FINAL
        WHERE step_id = {stepId:String}
        LIMIT 1
      `,
      query_params: { stepId },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as StepRow[];
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get decision events for a step
   * 
   * Trade-off: Query decision_events table directly.
   * No join with steps table - step_id is sufficient.
   * Returns references with S3 keys, not full payloads.
   */
  async getDecisionEventsByStepId(
    stepId: string,
    limit: number = 100
  ): Promise<DecisionEventRow[]> {
    const result = await this.client.query({
      query: `
        SELECT
          event_id,
          step_id,
          run_id,
          pipeline_id,
          outcome,
          item_id,
          score,
          timestamp,
          s3_key
        FROM ${this.database}.decision_events
        FINAL
        WHERE step_id = {stepId:String}
        ORDER BY timestamp ASC
        LIMIT {limit:UInt64}
      `,
      query_params: { stepId, limit },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as DecisionEventRow[];
    return rows;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

