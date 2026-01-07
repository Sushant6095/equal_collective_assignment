# Processor Worker

Worker service that polls events from a queue and processes them:
- Stores full raw payloads in S3/MinIO with deterministic keys
- Stores aggregated metrics in ClickHouse for analytics
- Idempotent processing (safe retries)

## Responsibilities

1. **Poll Events**: Continuously polls queue for new events
2. **Store Raw Payloads**: Stores complete event payloads in S3 with deterministic keys
3. **Aggregate Metrics**: Calculates and stores aggregated metrics in ClickHouse
4. **Idempotent Processing**: Safe to retry - same event ID always maps to same S3 key

## Architecture

### ClickHouse Schema

**runs table**: Aggregated run metrics
- `run_id`, `pipeline_id`, `status`
- `total_steps`, `total_input_count`, `total_output_count`
- `overall_elimination_ratio`
- Partitioned by month

**steps table**: Aggregated step metrics
- `step_id`, `run_id`, `pipeline_id`
- `input_count`, `output_count`, `elimination_ratio`
- `kept_count`, `eliminated_count`, `scored_count`
- Partitioned by month

**decision_events table**: Decision event references
- Links to S3 for full payloads
- `event_id`, `step_id`, `run_id`, `outcome`, `s3_key`
- Partitioned by month

### S3 Storage

Deterministic key format for idempotency:
- Decisions: `decisions/{year}/{month}/{day}/{eventId}.json`
- Runs: `runs/{year}/{month}/{day}/{runId}.json`
- Steps: `steps/{year}/{month}/{day}/{stepId}.json`

Same event ID always maps to same S3 key, ensuring idempotent processing.

## Metrics

### Step Metrics
- `input_count`: Number of items input to step
- `output_count`: Number of items output from step
- `elimination_ratio`: `1 - (output_count / input_count)`
- `kept_count`: Number of items kept
- `eliminated_count`: Number of items eliminated
- `scored_count`: Number of items scored

### Run Metrics
- `total_steps`: Total number of steps in run
- `total_input_count`: Sum of all step input counts
- `total_output_count`: Sum of all step output counts
- `overall_elimination_ratio`: Overall elimination ratio for the run

## Configuration

Environment variables:

- `CLICKHOUSE_HOST`: ClickHouse host (default: localhost)
- `CLICKHOUSE_PORT`: ClickHouse port (default: 8123)
- `CLICKHOUSE_DATABASE`: Database name (default: xray)
- `CLICKHOUSE_USER`: ClickHouse user (default: default)
- `CLICKHOUSE_PASSWORD`: ClickHouse password
- `MINIO_ENDPOINT`: MinIO endpoint (default: localhost)
- `MINIO_PORT`: MinIO port (default: 9000)
- `MINIO_ACCESS_KEY`: MinIO access key
- `MINIO_SECRET_KEY`: MinIO secret key
- `MINIO_BUCKET`: S3 bucket name (default: xray-raw)
- `MINIO_USE_SSL`: Use SSL (default: false)
- `QUEUE_TYPE`: Queue type (default: memory)
- `POLL_INTERVAL_MS`: Poll interval in milliseconds (default: 1000)
- `BATCH_SIZE`: Messages per poll (default: 10)
- `LOG_LEVEL`: Logging level (default: info)

## Idempotency

Processing is idempotent:
- Deterministic S3 keys based on event ID
- ReplacingMergeTree in ClickHouse handles duplicate inserts
- Same event processed multiple times produces same result

## Docker

```bash
docker build -t xray-processor-worker .
docker run xray-processor-worker
```

## Development

```bash
npm install
npm run dev
```

