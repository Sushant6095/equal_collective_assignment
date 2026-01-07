# System Verification Checklist

## ✅ Connection Points to Verify

### 1. SDK → Ingestion API
**SDK sends to**: `POST http://localhost:3000/ingest`
**Format**: `{ type: 'decisions'|'run'|'step', data: ... }`
**Status**: ✅ FIXED - Updated transport.ts to use `/ingest` endpoint

### 2. Ingestion API → Queue
**Ingestion API uses**: `queue.pushDecisionEvent()`
**Queue types**: `memory` (default) or `http` (for queue-service)
**Status**: ✅ OK - HttpQueue implementation exists

### 3. Queue → Processor Worker
**Worker polls**: `queue.poll(maxMessages)`
**Queue types**: `memory` or `http`
**Status**: ✅ OK - HttpQueue implementation exists

### 4. Processor Worker → ClickHouse
**Worker stores**: Metrics via `clickhouse.storeStepMetrics()`
**Tables**: `runs`, `steps`, `decision_events`
**Status**: ✅ OK - ClickHouse client implemented

### 5. Processor Worker → S3
**Worker stores**: Raw payloads via `s3.storeDecisionEvent()`
**Key format**: `decisions/{year}/{month}/{day}/{eventId}.json`
**Status**: ✅ OK - S3 client implemented

### 6. Query API → ClickHouse
**Query API reads**: Via `clickhouse.queryRuns()`, `clickhouse.getRunById()`
**Status**: ✅ OK - Query client implemented

### 7. Query API → S3
**Query API reads**: Via `s3.getDecisionEvent(s3Key)` when `?include_raw=true`
**Status**: ✅ OK - S3 client implemented

### 8. Dashboard → Query API
**Dashboard calls**: `fetch('http://localhost:3001/runs')`
**Status**: ✅ OK - API client implemented

## 🔧 Issues Found & Fixed

1. **SDK Transport Endpoints** - FIXED
   - Was: `/api/events/decisions`, `/api/runs`, `/api/steps`
   - Now: `/ingest` with `{ type, data }` format
   - File: `packages/sdk-core/src/transport.ts`

2. **Import Path** - FIXED
   - Was: `from '../../shared-types/src/index.js'`
   - Now: `from '@xray/shared-types'`
   - File: `packages/sdk-core/src/transport.ts`

## ⚠️ Missing Components

1. **Queue Service** - Source files deleted
   - Dockerfile exists but no source
   - Options:
     - Use `memory` queue (default, works for testing)
     - Recreate queue-service source files
     - Remove queue-service from docker-compose

## 🧪 Testing Steps

1. **Start Infrastructure**:
   ```bash
   cd infra
   docker-compose up -d
   ```

2. **Test SDK → Ingestion**:
   ```bash
   cd demo
   npm install
   export INGESTION_API_URL=http://localhost:3000
   npm run bad-pipeline
   ```

3. **Check Ingestion API**:
   ```bash
   curl http://localhost:3000/health
   ```

4. **Check Query API**:
   ```bash
   curl http://localhost:3001/runs
   ```

5. **Check Dashboard**:
   ```bash
   cd apps/dashboard
   npm install
   npm run dev
   # Open http://localhost:3000/runs
   ```

## 📋 Quick Verification Commands

```bash
# Check all services are running
docker-compose ps

# Check ingestion API logs
docker-compose logs ingestion-api

# Check processor worker logs
docker-compose logs processor-worker

# Check query API logs
docker-compose logs query-api

# Test ingestion endpoint
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"run","data":{"id":"test","pipelineId":"test","status":"completed","input":{},"output":{},"startedAt":"2024-01-01T00:00:00Z","completedAt":"2024-01-01T00:05:00Z","error":null}}'

# Query runs
curl http://localhost:3001/runs
```


