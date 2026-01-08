/**
 * ClickHouse query client
 * 
 * Design: Explicit SQL queries, no joins across large tables.
 * Each query is optimized for its specific use case.
 * 
 * ============================================================================
 * DATA MODEL RATIONALE
 * ============================================================================
 * 
 * Why Three Tables (runs, steps, decision_events)?
 * 
 * Each table serves a different query pattern optimized for ClickHouse:
 * 
 * 1. **runs table**: "Show me all pipeline executions from last week"
 *    - Query: SELECT * FROM runs WHERE started_at > '2024-01-01'
 *    - Fast: Single table scan, no joins, pre-aggregated metrics
 *    - Stores: run_id, pipeline_id, status, overall_elimination_ratio, etc.
 * 
 * 2. **steps table**: "Which step eliminated the most items?"
 *    - Query: SELECT step_name, elimination_ratio FROM steps WHERE run_id = 'x'
 *    - Fast: Filter by run_id (denormalized), no join needed
 *    - Stores: step_id, run_id, input_count, output_count, elimination_ratio
 * 
 * 3. **decision_events table**: "Why was item X eliminated at step Y?"
 *    - Query: SELECT * FROM decision_events WHERE item_id = 'phone-case-123'
 *    - Fast: Indexed by (run_id, step_id, timestamp), links to S3 for full payload
 *    - Stores: event_id, item_id, outcome, s3_key (not full payload)
 * 
 * Alternatives Considered:
 * 
 * 1. **Single Table with JSON**: Store everything in one table with nested JSON
 *    - Problem: ClickHouse JSON queries are slow, can't index nested fields
 *    - Would break: Fast filtering by run_id, step_id, item_id
 *    - Would break: Efficient aggregation queries (elimination ratios)
 * 
 * 2. **Normalized Schema with Joins**: Separate tables, join on foreign keys
 *    - Problem: ClickHouse joins are expensive, especially across large tables
 *    - Would break: Query performance - joins require shuffling data across nodes
 *    - Would break: Query simplicity - every query needs complex JOIN syntax
 * 
 * 3. **Store Full Payloads in ClickHouse**: Put entire decision event JSON in ClickHouse
 *    - Problem: ClickHouse storage is expensive for large JSON blobs
 *    - Would break: Cost efficiency - storing millions of full payloads is costly
 *    - Would break: Query performance - scanning large JSON columns is slow
 * 
 * 4. **Only S3 Storage**: Store everything in S3, no ClickHouse
 *    - Problem: S3 queries are slow, no indexing, no aggregation
 *    - Would break: Dashboard performance - can't quickly show "runs with high elimination"
 *    - Would break: Analytics - can't aggregate metrics across runs/steps
 * 
 * Current Design Trade-offs:
 * 
 * ✅ **Dual Storage (ClickHouse + S3)**:
 *    - ClickHouse: Fast queries on aggregated metrics and references
 *    - S3: Cheap storage for full payloads, fetched only when debugging
 *    - Trade-off: Two storage systems to maintain, but enables both fast queries and cost efficiency
 * 
 * ✅ **Denormalized IDs**:
 *    - run_id and step_id stored in both steps and decision_events tables
 *    - Trade-off: Data duplication, but enables queries without joins
 *    - Benefit: Each query hits one table, uses primary key/index efficiently
 * 
 * ✅ **ReplacingMergeTree Engine**:
 *    - Handles duplicate inserts (idempotent processing)
 *    - Trade-off: Must use FINAL keyword for immediate consistency (slower) or accept eventual consistency
 *    - Benefit: Safe retries, no need for complex upsert logic
 * 
 * ============================================================================
 * DEBUGGING WALKTHROUGH: Phone Case Matched to Laptop Stand
 * ============================================================================
 * 
 * Scenario: A competitor selection run returns a bad match - a phone case was
 * incorrectly matched against a laptop stand. Using X-Ray, here's how to debug:
 * 
 * Step 1: Identify the Problematic Run
 * 
 * Query: SELECT * FROM runs WHERE overall_elimination_ratio > 0.8 ORDER BY started_at DESC
 * 
 * What you see:
 * - run_id: "run-abc-123"
 * - pipeline_id: "competitor-selection"
 * - overall_elimination_ratio: 0.85 (85% eliminated - suspiciously high)
 * - status: "completed"
 * 
 * Step 2: Examine Steps in the Run
 * 
 * Query: SELECT * FROM steps WHERE run_id = 'run-abc-123' ORDER BY started_at ASC
 * 
 * What you see:
 * - Step 1: "generate-search-keywords" (LLM step) - input: 1, output: 7 keywords
 * - Step 2: "filter-by-keywords" (FILTER step) - input: 8, output: 2, elimination_ratio: 0.75
 * - Step 3: "filter-by-revenue" (FILTER step) - input: 2, output: 1, elimination_ratio: 0.50
 * - Step 4: "rank-by-relevance" (RANK step) - input: 1, output: 1, elimination_ratio: 0.00
 * 
 * Red flag: Step 2 has 75% elimination - this is where most items were filtered out.
 * 
 * Step 3: Inspect Decision Events for the Suspicious Step
 * 
 * Query: SELECT * FROM decision_events WHERE step_id = 'step-filter-keywords-456' 
 *        ORDER BY timestamp ASC
 * 
 * What you see (from ClickHouse):
 * - event_id: "evt-789", item_id: "phone-case-123", outcome: "kept", s3_key: "decisions/2024/01/15/evt-789.json"
 * - event_id: "evt-790", item_id: "laptop-stand-456", outcome: "kept", s3_key: "decisions/2024/01/15/evt-790.json"
 * - ... (other events with outcome: "eliminated")
 * 
 * Step 4: Fetch Full Payload from S3 to See Why Phone Case Was Kept
 * 
 * Fetch: GET s3://bucket/decisions/2024/01/15/evt-789.json
 * 
 * What you see in the raw payload:
 * {
 *   "itemId": "phone-case-123",
 *   "input": {
 *     "id": "phone-case-123",
 *     "name": "iPhone Case",
 *     "category": "phone-accessories",
 *     "keywords": ["phone", "case", "protection", "mobile"]
 *   },
 *   "outcome": "kept",
 *   "reason": "Matches all required keywords: phone, case, protection, mobile"
 * }
 * 
 * Step 5: Check What Keywords Were Generated (LLM Step)
 * 
 * Query: SELECT * FROM decision_events WHERE step_id = 'step-generate-keywords-123'
 * 
 * Fetch S3 payloads for keyword generation events to see:
 * - Generated keywords: ["laptop", "stand", "desk", "ergonomic", "adjustable"]
 * 
 * Step 6: Root Cause Identified
 * 
 * The problem: The keyword filter step incorrectly kept "phone-case-123" even though
 * the generated keywords were for "laptop stand". Looking at the decision event reason:
 * 
 * "Matches all required keywords: phone, case, protection, mobile"
 * 
 * But the required keywords were: ["laptop", "stand", "desk", "ergonomic", "adjustable"]
 * 
 * This reveals a bug: The filter logic is matching keywords incorrectly - possibly
 * doing substring matching instead of exact matching, or the keyword matching logic
 * has a flaw that allows "phone" to match "laptop" (maybe fuzzy matching gone wrong).
 * 
 * Step 7: Track the Item Through All Steps
 * 
 * Query: SELECT * FROM decision_events WHERE run_id = 'run-abc-123' 
 *        AND item_id = 'phone-case-123' ORDER BY timestamp ASC
 * 
 * What you see:
 * - Step 1 (generate-keywords): Not applicable (no item_id for LLM steps)
 * - Step 2 (filter-by-keywords): outcome: "kept", reason: "Matches all keywords"
 * - Step 3 (filter-by-revenue): outcome: "kept", reason: "Revenue meets threshold"
 * - Step 4 (rank-by-relevance): outcome: "scored", score: 0.65, reason: "Relevance score: 0.65"
 * 
 * This shows the phone case incorrectly passed through all filters and was ranked,
 * ending up as the final match when it should have been eliminated at step 2.
 * 
 * ============================================================================
 * QUERYABILITY: How Queries Work Without Joins
 * ============================================================================
 * 
 * The design prioritizes query performance by avoiding joins across large tables.
 * Instead, we denormalize foreign keys (run_id, step_id) into each table and
 * query each table independently.
 * 
 * Example Query Patterns:
 * 
 * 1. "Get all runs with high elimination ratio"
 *    Query: SELECT * FROM runs WHERE overall_elimination_ratio > 0.8
 *    Why it's fast: Single table scan, indexed by run_id, pre-aggregated metric
 *    No join needed: All data is in runs table
 * 
 * 2. "Get all steps for a run"
 *    Query: SELECT * FROM steps WHERE run_id = 'run-123' ORDER BY started_at
 *    Why it's fast: Filter by run_id (denormalized), no join with runs table
 *    No join needed: run_id is stored in steps table
 * 
 * 3. "Get all decision events for a step"
 *    Query: SELECT * FROM decision_events WHERE step_id = 'step-456' ORDER BY timestamp
 *    Why it's fast: Filter by step_id (denormalized), indexed by (run_id, step_id, timestamp)
 *    No join needed: step_id is stored in decision_events table
 * 
 * 4. "Track an item through all steps in a run"
 *    Query: SELECT * FROM decision_events WHERE run_id = 'run-123' 
 *           AND item_id = 'phone-case-123' ORDER BY timestamp
 *    Why it's fast: Filter by run_id + item_id, both denormalized in the table
 *    No join needed: All decision events for the item are in one table
 * 
 * 5. "Get step details with decision events"
 *    Application-level: Two separate queries, combine in application code
 *    - Query 1: SELECT * FROM steps WHERE step_id = 'step-456'
 *    - Query 2: SELECT * FROM decision_events WHERE step_id = 'step-456'
 *    Why it's fast: Each query hits one table, uses primary key/index
 *    Trade-off: Two queries instead of one join, but each is optimized
 * 
 * Why No Joins?
 * 
 * ClickHouse is columnar and optimized for single-table scans. Joins require:
 * - Shuffling data across nodes (in distributed setup)
 * - Building hash tables in memory
 * - Multiple table scans
 * 
 * Our denormalized design:
 * - Each query scans one table
 * - Uses primary key/index efficiently
 * - Predictable performance (no join planning)
 * - Scales linearly with table size
 * 
 * Trade-offs:
 * - Data duplication: run_id and step_id stored in multiple tables
 * - Storage cost: Slightly higher storage due to denormalization
 * - Consistency: Must update multiple tables when run/step metadata changes
 *    (mitigated by ReplacingMergeTree - idempotent inserts handle duplicates)
 * 
 * Benefits:
 * - Query performance: Each query is fast and predictable
 * - Simplicity: No complex JOIN syntax, easy to understand
 * - Scalability: Performance doesn't degrade with joins across large tables
 * - Flexibility: Can query any table independently without dependencies
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
    
    // Build connection config - completely omit password if empty
    // ClickHouse client has issues with empty string passwords
    const clientConfig: {
      host: string;
      username: string;
      database: string;
      password?: string;
    } = {
      host: `http://${config.host}:${config.port}`,
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
      // If table doesn't exist or query fails, return empty array
      // This allows dashboard to load even if no data exists yet
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('doesn\'t exist') || errorMessage.includes('Table') && errorMessage.includes('not found')) {
        // Table doesn't exist yet - processor worker hasn't initialized
        return [];
      }
      console.error('Error querying runs:', errorMessage);
      return [];
    }
  }

  /**
   * Get a specific run by ID
   * 
   * Trade-off: Direct lookup by primary key (run_id).
   * FINAL ensures we get the latest version from ReplacingMergeTree.
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
   * Get steps for a run
   * 
   * Trade-off: Query steps table directly, no join with runs.
   * Run ID is already in steps table, so no join needed.
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
   * Get a specific step by ID
   * 
   * Trade-off: Direct lookup, no joins.
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
   * Get all decision events for a specific item across all steps in a run
   * 
   * Use case: Track a specific product/item through the entire pipeline to debug
   * why it was kept, eliminated, or scored at each step.
   * 
   * Example: Debug why "phone-case-123" was incorrectly matched to "laptop-stand-456"
   * - Query all decision events for item_id = "phone-case-123" in run_id = "run-abc-123"
   * - See the decision at each step: kept at filter step, scored at rank step, etc.
   * - Fetch full payloads from S3 (using s3_key) to see input/output/reason for each decision
   * 
   * Trade-off: Single table query, no joins. item_id and run_id are denormalized
   * in decision_events table, so we can query directly without joining to steps/runs.
   * 
   * Queryability: This demonstrates how the denormalized design enables tracking
   * an item's journey through the pipeline with a single efficient query.
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

