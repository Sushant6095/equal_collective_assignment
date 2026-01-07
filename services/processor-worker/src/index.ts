/**
 * Processor Worker Service
 * 
 * Polls events from queue and processes them:
 * - Stores full payloads in S3/MinIO
 * - Stores aggregated metrics in ClickHouse
 */

import { ClickHouseStorage } from './clickhouse';
import { S3Storage } from './s3';
import { createQueue } from './queue';
import { ProcessorWorker } from './worker';
import { logger } from './logger';

async function main() {
  logger.info('Starting processor worker...');

  // Initialize ClickHouse
  const clickhouse = new ClickHouseStorage({
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: parseInt(process.env.CLICKHOUSE_PORT || '8123', 10),
    database: process.env.CLICKHOUSE_DATABASE || 'xray',
    user: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  });

  await clickhouse.initialize();
  logger.info('ClickHouse initialized');

  // Initialize S3/MinIO
  const s3 = new S3Storage({
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'xray-raw',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  });

  await s3.initialize();
  logger.info('S3/MinIO initialized');

  // Initialize queue
  const queue = createQueue();
  logger.info('Queue initialized', {
    type: process.env.QUEUE_TYPE || 'memory',
  });

  // Create and start worker
  const worker = new ProcessorWorker(
    clickhouse,
    s3,
    queue,
    {
      pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000', 10),
      batchSize: parseInt(process.env.BATCH_SIZE || '10', 10),
    }
  );

  await worker.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await worker.stop();
    await clickhouse.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    await worker.stop();
    await clickhouse.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Fatal error starting worker', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
