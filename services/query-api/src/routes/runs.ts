/**
 * Routes for run queries
 */

import { Router, Request, Response } from 'express';
import { ClickHouseQuery } from '../clickhouse';
import { S3Client } from '../s3';
import { RunListItem, RunDetail } from '../responses';
import { logger } from '../logger';

export function createRunRoutes(
  clickhouse: ClickHouseQuery,
  s3: S3Client
): Router {
  const router = Router();

  /**
   * GET /runs
   * 
   * Query parameters:
   * - bad_filter: Filter for "bad" runs (high elimination ratio, failures)
   * - limit: Number of results (default: 100)
   * - offset: Pagination offset (default: 0)
   * 
   * Response: Array of run list items (analytics only, no raw payloads)
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const badFilter = req.query.bad_filter === 'true';
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      logger.debug('Querying runs', { badFilter, limit, offset });

      const rows = await clickhouse.queryRuns(badFilter, limit, offset);

      const runs: RunListItem[] = rows.map((row) => ({
        id: row.run_id,
        pipelineId: row.pipeline_id,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error,
        metrics: {
          totalSteps: row.total_steps,
          totalInputCount: row.total_input_count,
          totalOutputCount: row.total_output_count,
          overallEliminationRatio: row.overall_elimination_ratio,
        },
      }));

      res.json({
        success: true,
        data: runs,
        count: runs.length,
      });
    } catch (error) {
      logger.error('Error querying runs', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        success: false,
        error: 'Failed to query runs',
      });
    }
  });

  /**
   * GET /runs/:id
   * 
   * Get a specific run with its steps.
   * Optionally includes raw payload from S3 if ?include_raw=true
   * 
   * Trade-off: Raw payload is optional to keep default response fast.
   * Only fetch from S3 when explicitly requested.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const includeRaw = req.query.include_raw === 'true';

      logger.debug('Getting run', { runId, includeRaw });

      // Query ClickHouse for run metrics
      const runRow = await clickhouse.getRunById(runId);
      if (!runRow) {
        return res.status(404).json({
          success: false,
          error: 'Run not found',
        });
      }

      // Query ClickHouse for steps (no join - separate query)
      const stepRows = await clickhouse.getStepsByRunId(runId);

      // Optionally fetch raw payload from S3
      let rawPayload: unknown = undefined;
      if (includeRaw) {
        const startedAt = new Date(runRow.started_at);
        const s3Key = s3.getRunKey(runId, startedAt);
        rawPayload = await s3.getRun(s3Key);
        if (!rawPayload) {
          logger.warn('Raw run payload not found in S3', { runId, s3Key });
        }
      }

      const run: RunDetail = {
        id: runRow.run_id,
        pipelineId: runRow.pipeline_id,
        status: runRow.status,
        startedAt: runRow.started_at,
        completedAt: runRow.completed_at,
        error: runRow.error,
        metrics: {
          totalSteps: runRow.total_steps,
          totalInputCount: runRow.total_input_count,
          totalOutputCount: runRow.total_output_count,
          overallEliminationRatio: runRow.overall_elimination_ratio,
        },
        steps: stepRows.map((step) => ({
          id: step.step_id,
          runId: step.run_id,
          pipelineId: step.pipeline_id,
          type: step.step_type,
          name: step.step_name,
          startedAt: step.started_at,
          completedAt: step.completed_at,
          metrics: {
            inputCount: step.input_count,
            outputCount: step.output_count,
            eliminationRatio: step.elimination_ratio,
            keptCount: step.kept_count,
            eliminatedCount: step.eliminated_count,
            scoredCount: step.scored_count,
          },
        })),
        rawPayload,
      };

      res.json({
        success: true,
        data: run,
      });
    } catch (error) {
      logger.error('Error getting run', {
        runId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get run',
      });
    }
  });

  return router;
}

