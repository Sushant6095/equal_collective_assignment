/**
 * Routes for step queries
 */

import { Router, Request, Response } from 'express';
import { ClickHouseQuery } from '../clickhouse';
import { S3Client } from '../s3';
import { StepDetail } from '../responses';
import { logger } from '../logger';

export function createStepRoutes(
  clickhouse: ClickHouseQuery,
  s3: S3Client
): Router {
  const router = Router();

  /**
   * GET /steps/:id/details
   * 
   * Get detailed step information including decision events.
   * Optionally includes raw payloads from S3 if ?include_raw=true
   * 
   * Trade-off: Decision events are fetched from ClickHouse (references only).
   * Full payloads are only fetched from S3 when explicitly requested.
   * This keeps default response fast while allowing full traceability when needed.
   */
  router.get('/:id/details', async (req: Request, res: Response) => {
    try {
      const stepId = req.params.id;
      const includeRaw = req.query.include_raw === 'true';
      const decisionLimit = parseInt(req.query.decision_limit as string) || 100;

      logger.debug('Getting step details', {
        stepId,
        includeRaw,
        decisionLimit,
      });

      // Query ClickHouse for step metrics
      const stepRow = await clickhouse.getStepById(stepId);
      if (!stepRow) {
        return res.status(404).json({
          success: false,
          error: 'Step not found',
        });
      }

      // Query ClickHouse for decision events (no join - separate query)
      const decisionEventRows = await clickhouse.getDecisionEventsByStepId(
        stepId,
        decisionLimit
      );

      // Optionally fetch raw payloads from S3
      let rawPayload: unknown = undefined;
      const decisionEvents = await Promise.all(
        decisionEventRows.map(async (eventRow) => {
          let rawEventPayload: unknown = undefined;
          if (includeRaw) {
            rawEventPayload = await s3.getDecisionEvent(eventRow.s3_key);
            if (!rawEventPayload) {
              logger.warn('Raw decision event payload not found in S3', {
                eventId: eventRow.event_id,
                s3Key: eventRow.s3_key,
              });
            }
          }

          return {
            id: eventRow.event_id,
            stepId: eventRow.step_id,
            runId: eventRow.run_id,
            outcome: eventRow.outcome,
            itemId: eventRow.item_id,
            score: eventRow.score,
            timestamp: eventRow.timestamp,
            s3Key: eventRow.s3_key,
            rawPayload: rawEventPayload,
          };
        })
      );

      if (includeRaw) {
        const startedAt = new Date(stepRow.started_at);
        const s3Key = s3.getStepKey(stepId, startedAt);
        rawPayload = await s3.getStep(s3Key);
        if (!rawPayload) {
          logger.warn('Raw step payload not found in S3', { stepId, s3Key });
        }
      }

      const step: StepDetail = {
        id: stepRow.step_id,
        runId: stepRow.run_id,
        pipelineId: stepRow.pipeline_id,
        type: stepRow.step_type,
        name: stepRow.step_name,
        startedAt: stepRow.started_at,
        completedAt: stepRow.completed_at,
        metrics: {
          inputCount: stepRow.input_count,
          outputCount: stepRow.output_count,
          eliminationRatio: stepRow.elimination_ratio,
          keptCount: stepRow.kept_count,
          eliminatedCount: stepRow.eliminated_count,
          scoredCount: stepRow.scored_count,
        },
        decisionEvents,
        rawPayload,
      };

      res.json({
        success: true,
        data: step,
      });
    } catch (error) {
      logger.error('Error getting step details', {
        stepId: req.params.id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get step details',
      });
    }
  });

  return router;
}

