/**
 * ClickHouse query client
 * 
 * Three tables: runs (pipeline executions), steps (step metrics), decision_events (item decisions).
 * We denormalize run_id/step_id into each table to avoid joins - ClickHouse is much faster with single-table queries.
 * Full payloads go to S3, ClickHouse just stores references and metrics.
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
 * ClickHouse query client - direct SQL, no ORM
 */
export class ClickHouseQuery {
  private client: ClickHouseClient;
  private database: string;

  constructor(config: ClickHouseConfig) {
    this.database = config.database;
    
    // Omit password if empty - ClickHouse client doesn't like empty strings
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
    
    // Only add password if it's actually set
    const password = config.password?.trim();
    if (password && password.length > 0) {
      clientConfig.password = password;
    }
    
    this.client = createClient(clientConfig);
  }

  /**
   * Get runs, optionally filtered for bad ones (high elimination ratio, failed, or errors)
   */
  async queryRuns(
    badFilter: boolean = false,
    limit: number = 100,
    offset: number = 0
  ): Promise<RunRow[]> {
    try {
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
    } catch (error: any) {
      // Return empty array if table doesn't exist yet (dashboard can still load)
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('doesn\'t exist') || errorMessage.includes('Table') && errorMessage.includes('not found')) {
        // Table doesn't exist yet
        return [];
      }
      console.error('Error querying runs:', errorMessage);
      return [];
    }
  }

  /**
   * Get a run by ID. FINAL ensures we get the latest version from ReplacingMergeTree.
   */
  async getRunById(runId: string): Promise<RunRow | null> {
    try {
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
    } catch (error: any) {
      // Table doesn't exist or query failed
      console.error('Error getting run by ID:', error?.message || String(error));
      return null;
    }
  }

  /**
   * Get all steps for a run. No join needed - run_id is in the steps table.
   */
  async getStepsByRunId(runId: string): Promise<StepRow[]> {
    try {
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
    } catch (error: any) {
      // Table doesn't exist or query failed
      console.error('Error getting steps by run ID:', error?.message || String(error));
      return [];
    }
  }

  /**
   * Get a step by ID
   */
  async getStepById(stepId: string): Promise<StepRow | null> {
    try {
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
    } catch (error: any) {
      console.error('Error getting step by ID:', error?.message || String(error));
      return null;
    }
  }

  /**
   * Get decision events for a step. Returns S3 keys, not full payloads.
   */
  async getDecisionEventsByStepId(
    stepId: string,
    limit: number = 100
  ): Promise<DecisionEventRow[]> {
    try {
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
    } catch (error: any) {
      console.error('Error getting decision events by step ID:', error?.message || String(error));
      return [];
    }
  }

  /**
   * Track an item through all steps in a run. Useful for debugging why something
   * was kept/eliminated. Returns S3 keys to fetch full payloads if needed.
   */
  async getDecisionEventsByItemId(
    runId: string,
    itemId: string,
    limit: number = 1000
  ): Promise<DecisionEventRow[]> {
    try {
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
          WHERE run_id = {runId:String} AND item_id = {itemId:String}
          ORDER BY timestamp ASC
          LIMIT {limit:UInt64}
        `,
        query_params: { runId, itemId, limit },
        format: 'JSONEachRow',
      });

      const rows = await result.json() as DecisionEventRow[];
      return rows;
    } catch (error: any) {
      console.error('Error getting decision events by item ID:', error?.message || String(error));
      return [];
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

