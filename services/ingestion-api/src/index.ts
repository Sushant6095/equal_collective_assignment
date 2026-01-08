/**
 * Ingestion API Service
 * 
 * Receives X-Ray events via HTTP and pushes them to a queue.
 * Stateless design: No database writes, all state in queue.
 */

import express from 'express';
import { createServer } from 'http';
import * as net from 'net';
import { createQueue } from './queue';
import { createIngestRoutes } from './routes/ingest';
import { logger } from './logger';

/**
 * Find an available port, starting from the preferred port
 */
async function findAvailablePort(preferredPort: number): Promise<number> {
  
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(preferredPort, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try a random port (0 = OS assigns available port)
        const randomServer = net.createServer();
        randomServer.listen(0, () => {
          const address = randomServer.address();
          const port = typeof address === 'object' && address ? address.port : 0;
          randomServer.close(() => resolve(port));
        });
        randomServer.on('error', reject);
      } else {
        reject(err);
      }
    });
  });
}

async function main() {
  // Initialize queue
  const queue = createQueue();
  logger.info('Queue initialized', { type: process.env.QUEUE_TYPE || 'memory' });

  // Create Express app
  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' })); // Limit payload size
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req, res, next) => {
    logger.debug('Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
    next();
  });

  // Routes
  app.use('/', createIngestRoutes(queue));

  // Error handling middleware
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

  // Find available port
  const preferredPort = parseInt(process.env.PORT || '3000', 10);
  const port = await findAvailablePort(preferredPort);
  
  // Create HTTP server
  const server = createServer(app);
  
  // Start server
  server.listen(port, () => {
    logger.info('Ingestion API started', {
      port: port,
      preferredPort: preferredPort !== port ? preferredPort : undefined,
      env: process.env.NODE_ENV || 'development',
    });
    
    // Log the actual URL for easy access
    console.log(`\n✅ Ingestion API running on http://localhost:${port}`);
    if (port !== preferredPort) {
      console.log(`   (Port ${preferredPort} was in use, using ${port} instead)\n`);
    }
  });
  
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port already in use, trying random port', { port });
      // This shouldn't happen since we already checked, but handle it anyway
    } else {
      logger.error('Server error', { error: err.message });
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
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
