/**
 * HTTP routes for ingestion API
 * 
 * Clean separation: HTTP layer is isolated from validation and queue logic.
 * This allows us to swap HTTP frameworks (Express → Fastify) without changing
 * business logic.
 */

import { Router, Request, Response } from 'express';
import { EventQueue } from '../queue';
import {
  validateDecisionEvent,
  validateDecisionEvents,
  validateRun,
  validateStep,
} from '../validation';
import { logger } from '../logger';

/**
 * Create ingestion routes
 * 
 * Trade-off: Single endpoint `/ingest` that accepts different event types.
 * Alternative: Separate endpoints (`/ingest/events`, `/ingest/runs`, `/ingest/steps`),
 * but single endpoint is simpler and more flexible.
 */
export function createIngestRoutes(queue: EventQueue): Router {
  const router = Router();

  /**
   * POST /ingest
   * 
   * Accepts:
   * - Single decision event: { type: 'decision', data: XRDecisionEvent }
   * - Batch of decision events: { type: 'decisions', data: XRDecisionEvent[] }
   * - Run: { type: 'run', data: XRRun }
   * - Step: { type: 'step', data: XRStep }
   * 
   * Graceful error handling: Malformed events return 400 with error details,
   * but valid events in a batch are still processed.
   */
  router.post('/ingest', async (req: Request, res: Response) => {
    try {
      const { type, data } = req.body;

      if (!type || !data) {
        logger.warn('Invalid request: missing type or data', {
          body: req.body,
        });
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: type and data',
        });
      }

      switch (type) {
        case 'decision': {
          const validation = validateDecisionEvent(data);
          if (!validation.success) {
            logger.warn('Invalid decision event', {
              error: validation.error,
              data,
            });
            return res.status(400).json({
              success: false,
              error: validation.error,
              details: validation.details?.errors,
            });
          }

          const queued = await queue.pushDecisionEvent(validation.data!);
          if (!queued) {
            logger.error('Failed to queue decision event', {
              eventId: validation.data!.id,
            });
            return res.status(500).json({
              success: false,
              error: 'Failed to queue event',
            });
          }

          logger.info('Decision event queued', {
            eventId: validation.data!.id,
            runId: validation.data!.runId,
            stepId: validation.data!.stepId,
          });

          return res.status(200).json({
            success: true,
            queued: true,
          });
        }

        case 'decisions': {
          // Batch ingestion
          const validation = validateDecisionEvents(data);
          if (!validation.success || !validation.data) {
            logger.warn('Invalid decision events batch', {
              error: validation.error,
              count: Array.isArray(data) ? data.length : 0,
            });
            return res.status(400).json({
              success: false,
              error: validation.error,
            });
          }

          const queuedCount = await queue.pushDecisionEvents(validation.data);
          const totalCount = validation.data.length;

          logger.info('Decision events batch queued', {
            queued: queuedCount,
            total: totalCount,
            runId: validation.data[0]?.runId,
          });

          return res.status(200).json({
            success: true,
            queued: queuedCount,
            total: totalCount,
            partial: queuedCount < totalCount,
            warning: validation.error,
          });
        }

        case 'run': {
          const validation = validateRun(data);
          if (!validation.success) {
            logger.warn('Invalid run', {
              error: validation.error,
              data,
            });
            return res.status(400).json({
              success: false,
              error: validation.error,
              details: validation.details?.errors,
            });
          }

          const queued = await queue.pushRun(validation.data!);
          if (!queued) {
            logger.error('Failed to queue run', {
              runId: validation.data!.id,
            });
            return res.status(500).json({
              success: false,
              error: 'Failed to queue run',
            });
          }

          logger.info('Run queued', {
            runId: validation.data!.id,
            pipelineId: validation.data!.pipelineId,
            status: validation.data!.status,
          });

          return res.status(200).json({
            success: true,
            queued: true,
          });
        }

        case 'step': {
          const validation = validateStep(data);
          if (!validation.success) {
            logger.warn('Invalid step', {
              error: validation.error,
              data,
            });
            return res.status(400).json({
              success: false,
              error: validation.error,
              details: validation.details?.errors,
            });
          }

          const queued = await queue.pushStep(validation.data!);
          if (!queued) {
            logger.error('Failed to queue step', {
              stepId: validation.data!.id,
            });
            return res.status(500).json({
              success: false,
              error: 'Failed to queue step',
            });
          }

          logger.info('Step queued', {
            stepId: validation.data!.id,
            runId: validation.data!.type,
            name: validation.data!.name,
          });

          return res.status(200).json({
            success: true,
            queued: true,
          });
        }

        default:
          logger.warn('Unknown event type', { type });
          return res.status(400).json({
            success: false,
            error: `Unknown event type: ${type}. Expected: decision, decisions, run, or step`,
          });
      }
    } catch (error) {
      // Graceful error handling: Log but don't expose internal errors
      logger.error('Unexpected error in ingestion', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * Health check endpoint
   */
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

