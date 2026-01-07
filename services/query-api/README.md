# Query API

HTTP API for querying X-Ray analytics and raw payloads.

## Features

- **Fast Analytics**: Queries ClickHouse for aggregated metrics
- **Lazy Loading**: Fetches raw payloads from S3 only when requested
- **No Joins**: Explicit SQL queries, no joins across large tables
- **Clear Responses**: Well-defined response shapes

## API Endpoints

### GET /runs

List runs with optional filter for "bad" runs.

**Query Parameters:**
- `bad_filter` (boolean): Filter for runs with high elimination ratio (>0.8), failures, or errors
- `limit` (number): Number of results (default: 100)
- `offset` (number): Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "run-123",
      "pipelineId": "pipeline-1",
      "status": "completed",
      "startedAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:05:00Z",
      "error": null,
      "metrics": {
        "totalSteps": 3,
        "totalInputCount": 1000,
        "totalOutputCount": 200,
        "overallEliminationRatio": 0.8
      }
    }
  ],
  "count": 1
}
```

**Example:**
```bash
# Get all runs
curl http://localhost:3001/runs

# Get only "bad" runs
curl http://localhost:3001/runs?bad_filter=true

# Paginated
curl http://localhost:3001/runs?limit=50&offset=0
```

### GET /runs/:id

Get a specific run with its steps.

**Query Parameters:**
- `include_raw` (boolean): Include full raw payload from S3 (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "run-123",
    "pipelineId": "pipeline-1",
    "status": "completed",
    "startedAt": "2024-01-01T00:00:00Z",
    "completedAt": "2024-01-01T00:05:00Z",
    "error": null,
    "metrics": {
      "totalSteps": 3,
      "totalInputCount": 1000,
      "totalOutputCount": 200,
      "overallEliminationRatio": 0.8
    },
    "steps": [
      {
        "id": "step-456",
        "runId": "run-123",
        "pipelineId": "pipeline-1",
        "type": "filter",
        "name": "filter-low-scores",
        "startedAt": "2024-01-01T00:00:00Z",
        "completedAt": "2024-01-01T00:02:00Z",
        "metrics": {
          "inputCount": 1000,
          "outputCount": 500,
          "eliminationRatio": 0.5,
          "keptCount": 500,
          "eliminatedCount": 500,
          "scoredCount": 0
        }
      }
    ],
    "rawPayload": { /* full XRRun payload if include_raw=true */ }
  }
}
```

**Example:**
```bash
# Get run without raw payload (fast)
curl http://localhost:3001/runs/run-123

# Get run with raw payload
curl http://localhost:3001/runs/run-123?include_raw=true
```

### GET /steps/:id/details

Get detailed step information including decision events.

**Query Parameters:**
- `include_raw` (boolean): Include full raw payloads from S3 (default: false)
- `decision_limit` (number): Max decision events to return (default: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "step-456",
    "runId": "run-123",
    "pipelineId": "pipeline-1",
    "type": "filter",
    "name": "filter-low-scores",
    "startedAt": "2024-01-01T00:00:00Z",
    "completedAt": "2024-01-01T00:02:00Z",
    "metrics": {
      "inputCount": 1000,
      "outputCount": 500,
      "eliminationRatio": 0.5,
      "keptCount": 500,
      "eliminatedCount": 500,
      "scoredCount": 0
    },
    "decisionEvents": [
      {
        "id": "event-789",
        "stepId": "step-456",
        "runId": "run-123",
        "outcome": "kept",
        "itemId": "item-1",
        "score": 0.95,
        "timestamp": "2024-01-01T00:01:00Z",
        "s3Key": "decisions/2024/01/01/event-789.json",
        "rawPayload": { /* full XRDecisionEvent if include_raw=true */ }
      }
    ],
    "rawPayload": { /* full XRStep payload if include_raw=true */ }
  }
}
```

**Example:**
```bash
# Get step details without raw payloads (fast)
curl http://localhost:3001/steps/step-456/details

# Get step details with raw payloads
curl http://localhost:3001/steps/step-456/details?include_raw=true

# Limit decision events
curl http://localhost:3001/steps/step-456/details?decision_limit=50
```

## Architecture

### Query Strategy

1. **ClickHouse First**: All analytics queries go to ClickHouse (fast, aggregated data)
2. **S3 on Demand**: Raw payloads only fetched when `include_raw=true`
3. **No Joins**: Separate queries for runs, steps, and decision events
4. **Explicit SQL**: Direct SQL queries for clarity and performance

### Response Design

- **Default**: Fast responses with analytics only (no S3 fetches)
- **Optional**: Raw payloads available via query parameter
- **Clear Shapes**: Well-defined TypeScript interfaces for responses

## Configuration

Environment variables:

- `PORT`: Server port (default: 3001)
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
- `LOG_LEVEL`: Logging level (default: info)

## Docker

```bash
docker build -t xray-query-api .
docker run -p 3001:3001 xray-query-api
```

## Development

```bash
npm install
npm run dev
```


