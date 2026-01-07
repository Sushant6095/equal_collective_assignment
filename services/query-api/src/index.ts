/**
 * Query API Service
 * 
 * Provides query endpoints for X-Ray analytics:
 * - GET /runs - List runs with optional bad filter
 * - GET /runs/:id - Get run details
 * - GET /steps/:id/details - Get step details
 */

import express from 'express';
import { ClickHouseQuery } from './clickhouse';
import { S3Client } from './s3';
import { createRunRoutes } from './routes/runs';
import { createStepRoutes } from './routes/steps';
import { logger } from './logger';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  logger.info('Starting query API...');

  // Initialize ClickHouse
  const clickhouse = new ClickHouseQuery({
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10),
    database: process.env.CLICKHOUSE_DATABASE || 'xray',
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });
  logger.info('ClickHouse initialized');

  // Initialize S3
  const s3 = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'xray-raw',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  });
  logger.info('S3/MinIO initialized');

  // Create Express app
  const app = express();

  // Middleware
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    logger.debug('Incoming request', {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Routes
  app.use('/runs', createRunRoutes(clickhouse, s3));
  app.use('/steps', createStepRoutes(clickhouse, s3));

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Error handling
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        path: req.path,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  );

  // Start server
  app.listen(PORT, () => {
    logger.info('Query API started', {
      port: PORT,
      env: process.env.NODE_ENV || 'development',
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await clickhouse.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await clickhouse.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Fatal error starting server', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
