# Infrastructure

Docker Compose setup for running X-Ray system locally.

## Quick Start

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

## Services

### Infrastructure Services

- **ClickHouse** (port 8123): Analytics database
  - Auto-creates schema on first connection
  - Data persisted in `clickhouse-data` volume

- **MinIO** (ports 9002, 9001): S3-compatible storage
  - API: http://localhost:9002 (mapped from container port 9000)
  - Console: http://localhost:9001 (minioadmin/minioadmin)
  - Data persisted in `minio-data` volume

- **Redis** (port 6379): Message broker for queue
  - Used by queue service
  - Data persisted in `redis-data` volume

- **Queue Service** (port 3002): HTTP-based queue API
  - Simple queue abstraction for local development
  - Uses Redis for persistence

### Application Services

- **Ingestion API** (port 3000): Receives X-Ray events
  - Health: http://localhost:3000/health
  - Endpoint: http://localhost:3000/ingest

- **Processor Worker**: Processes events from queue
  - No exposed ports (internal only)
  - Polls queue, writes to ClickHouse and MinIO

- **Query API** (port 3001): Query analytics
  - Health: http://localhost:3001/health
  - Endpoints: http://localhost:3001/runs, http://localhost:3001/runs/:id

## Environment Variables

### ClickHouse
- `CLICKHOUSE_HOST`: Hostname (default: clickhouse)
- `CLICKHOUSE_PORT`: Port (default: 8123)
- `CLICKHOUSE_DATABASE`: Database name (default: xray)
- `CLICKHOUSE_USER`: Username (default: default)
- `CLICKHOUSE_PASSWORD`: Password (default: "")

### MinIO
- `MINIO_ENDPOINT`: Endpoint (default: minio)
- `MINIO_PORT`: Port (default: 9000)
- `MINIO_ACCESS_KEY`: Access key (default: minioadmin)
- `MINIO_SECRET_KEY`: Secret key (default: minioadmin)
- `MINIO_BUCKET`: Bucket name (default: xray-raw)
- `MINIO_USE_SSL`: Use SSL (default: false)

### Queue Service
- `QUEUE_TYPE`: Queue type (http for queue-service)
- `QUEUE_URL`: Queue service URL (default: http://queue-service:3002)

### Application Services
- `PORT`: Service port
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

## ClickHouse Schema

Schema is automatically created when processor-worker starts:
- `runs` table: Aggregated run metrics
- `steps` table: Aggregated step metrics
- `decision_events` table: Decision event references

## Data Persistence

All data is persisted in Docker volumes:
- `clickhouse-data`: ClickHouse data
- `minio-data`: MinIO/S3 data
- `redis-data`: Redis data

To start fresh:
```bash
docker-compose down -v
docker-compose up -d
```

## Health Checks

All services have health checks. Check status:
```bash
docker-compose ps
```

## Troubleshooting

### Services won't start
1. Check logs: `docker-compose logs [service-name]`
2. Ensure ports aren't already in use
3. Check health checks: `docker-compose ps`

### ClickHouse schema not created
- Processor worker creates schema on startup
- Check processor-worker logs for initialization messages

### Queue not working
- Ensure Redis is healthy: `docker-compose ps redis`
- Check queue service logs: `docker-compose logs queue-service`
- Test queue API: `curl http://localhost:3002/health`

## Development

To rebuild services after code changes:
```bash
docker-compose build [service-name]
docker-compose up -d [service-name]
```

To rebuild all:
```bash
docker-compose build
docker-compose up -d
```

