# Complete Codebase Explanation

## 📦 PACKAGES - Shared Libraries

### `packages/shared-types/` - Type Definitions

**Purpose**: Single source of truth for all data structures used across services.

#### `src/types.ts`
**What it does**: Defines core data model interfaces and enums.

**Key Code**:
```typescript
export interface XRDecisionEvent {
  id: string;
  stepId: string;
  runId: string;
  outcome: XRDecisionOutcome;  // kept | eliminated | scored
  itemId: string;
  input: unknown;
  output: unknown;
  reason: string;
  score?: number;
  timestamp: Date;
}
```

**Why useful**: 
- All services import from here → ensures consistency
- TypeScript enforces correct usage
- Changes in one place propagate everywhere

**Connections**:
- Used by: SDK, Ingestion API, Processor Worker, Query API
- Imported as: `import { XRDecisionEvent } from '@xray/shared-types'`

#### `src/index.ts`
**What it does**: Re-exports all types for clean imports.

**Code**: `export * from './types';`

**Why useful**: Allows `import { XRDecisionEvent } from '@xray/shared-types'` instead of `from '@xray/shared-types/src/types'`

---

### `packages/sdk-core/` - Client SDK

**Purpose**: Library that applications use to track decisions.

#### `src/XRay.ts` - Main SDK Class
**What it does**: Provides `startRun()`, `step()`, `endRun()` API.

**Key Code**:
```typescript
async step(runId, stepType, stepName, businessLogic, input) {
  // 1. Execute your business logic
  const output = await businessLogic(input);
  
  // 2. Automatically capture decisions
  this.captureStepMetrics(runId, stepId, input, output);
  
  // 3. Return result (non-blocking)
  return output;
}
```

**How it works**:
1. Wraps your business logic execution
2. Extracts decisions from your return value
3. Buffers events asynchronously
4. Never blocks your code

**Why useful**: 
- Simple API: just wrap your logic
- Automatic tracking - no manual event emission
- Non-blocking - never slows down your app

**Connections**:
- Uses: `buffer.ts` (batches events), `transport.ts` (sends HTTP), `sampler.ts` (samples)
- Used by: Your application code, demo pipelines

#### `src/buffer.ts` - Event Batching
**What it does**: Batches events before sending to reduce HTTP overhead.

**Key Code**:
```typescript
add(event: XRDecisionEvent): void {
  this.buffer.push(event);
  
  // Auto-flush when batch size reached
  if (this.buffer.length >= 100) {
    this.flush().catch(() => {}); // Fire-and-forget
  }
}
```

**How it works**:
- Collects events in memory array
- Flushes when buffer reaches 100 events OR every 5 seconds
- Drops oldest events if buffer full (never blocks)

**Why useful**: 
- Reduces HTTP requests (1 request per 100 events vs 1 per event)
- Time-based flush prevents stale data
- Non-blocking (drops events if full)

**Connections**:
- Used by: `XRay.ts` (adds events to buffer)
- Calls: `transport.ts` (flush callback sends HTTP)

#### `src/sampler.ts` - Adaptive Sampling
**What it does**: Reduces large batches (5000 → 5) while keeping important items.

**Key Code**:
```typescript
shouldSample(itemIndex, totalCount, targetSize = 5): boolean {
  // Always sample first and last (boundary cases)
  if (itemIndex === 0 || itemIndex === totalCount - 1) {
    return true;
  }
  
  // Sample uniformly to reach target size
  const ratio = (targetSize - 2) / (totalCount - 2);
  return itemIndex / totalCount < ratio;
}
```

**How it works**:
- Always includes first and last items
- Uniformly samples middle items
- Scales logarithmically for very large batches

**Why useful**: 
- Reduces storage costs (5 events vs 5000)
- Keeps representative sample
- Captures edge cases (first/last)

**Connections**:
- Used by: `XRay.ts` (when captureLevel = SAMPLED)
- Called during: `captureStepMetrics()`

#### `src/transport.ts` - HTTP Client
**What it does**: Sends events to Ingestion API with retry logic.

**Key Code**:
```typescript
async sendDecisionEvents(events: XRDecisionEvent[]): Promise<void> {
  try {
    await this.sendWithRetry('/api/events/decisions', events);
  } catch (error) {
    // Silent failure - never throw
  }
}

private async sendWithRetry(endpoint, data) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      await fetch(url, { method: 'POST', body: JSON.stringify(data) });
      return; // Success
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(1000 * Math.pow(2, attempt)); // Exponential backoff
    }
  }
}
```

**How it works**:
- Sends HTTP POST to Ingestion API
- Retries 3 times with exponential backoff
- Swallows all errors (never throws to app)

**Why useful**: 
- Resilient to network issues
- Never crashes your app
- Handles API downtime gracefully

**Connections**:
- Used by: `XRay.ts` (via buffer flush callback)
- Sends to: `services/ingestion-api` (port 3000)

#### `src/index.ts`
**What it does**: Exports public API.

**Code**: Re-exports `XRay`, `CaptureLevel`, etc.

---

## 🔧 SERVICES - Backend Services

### `services/ingestion-api/` - Event Receiver

**Purpose**: Receives events from SDK, validates, queues them.

#### `src/index.ts` - Entry Point
**What it does**: Starts Express server on port 3000.

**Key Code**:
```typescript
const app = express();
app.use(express.json());
app.use('/', createIngestRoutes(queue));
app.listen(3000);
```

**How it works**:
- Creates Express app
- Registers `/ingest` route
- Initializes queue (memory or HTTP)

**Connections**:
- Uses: `routes/ingest.ts`, `queue.ts`, `validation.ts`
- Receives from: SDK (`transport.ts`)

#### `src/routes/ingest.ts` - HTTP Handler
**What it does**: Handles POST /ingest requests.

**Key Code**:
```typescript
router.post('/ingest', async (req, res) => {
  const { type, data } = req.body; // type: 'decision' | 'run' | 'step'
  
  // Validate
  const validation = validateDecisionEvent(data);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error });
  }
  
  // Queue
  await queue.pushDecisionEvent(validation.data);
  res.json({ success: true });
});
```

**How it works**:
1. Receives HTTP POST with event
2. Validates using Zod schema
3. Pushes to queue
4. Returns 200 OK immediately

**Why useful**: 
- Stateless (no database writes)
- Fast response (just queues)
- Graceful error handling

**Connections**:
- Uses: `validation.ts` (validates), `queue.ts` (queues)
- Called by: SDK (`transport.ts`)

#### `src/validation.ts` - Schema Validation
**What it does**: Validates incoming events using Zod.

**Key Code**:
```typescript
const DecisionEventSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  outcome: z.nativeEnum(XRDecisionOutcome),
  // ... more fields
});

export function validateDecisionEvent(data: unknown) {
  try {
    const parsed = DecisionEventSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

**How it works**:
- Defines Zod schemas for each event type
- Parses and validates incoming data
- Returns structured result (not exception)

**Why useful**: 
- Catches malformed events early
- Clear error messages
- Type-safe at runtime

**Connections**:
- Used by: `routes/ingest.ts`
- Validates: Types from `@xray/shared-types`

#### `src/queue.ts` - Queue Abstraction
**What it does**: Abstracts queue operations (memory or HTTP).

**Key Code**:
```typescript
export interface EventQueue {
  pushDecisionEvent(event: XRDecisionEvent): Promise<boolean>;
  pushRun(run: XRRun): Promise<boolean>;
  pushStep(step: XRStep): Promise<boolean>;
}

export class InMemoryQueue implements EventQueue {
  private decisionEvents: XRDecisionEvent[] = [];
  
  async pushDecisionEvent(event) {
    this.decisionEvents.push(event);
    return true;
  }
}

export class HttpQueue implements EventQueue {
  async pushDecisionEvent(event) {
    await fetch(`${this.baseUrl}/push`, {
      method: 'POST',
      body: JSON.stringify({ type: 'decision', data: event })
    });
  }
}
```

**How it works**:
- Interface allows swapping implementations
- InMemoryQueue: Simple array (for testing)
- HttpQueue: HTTP calls to queue service (for production)

**Why useful**: 
- Clean separation (HTTP layer doesn't know queue type)
- Easy to swap (memory → SQS → HTTP)
- Testable (mock interface)

**Connections**:
- Used by: `routes/ingest.ts`
- Implementations: `InMemoryQueue`, `HttpQueue`

#### `src/logger.ts` - Structured Logging
**What it does**: JSON-formatted logging.

**Key Code**:
```typescript
log(level, message, context) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'ingestion-api',
    ...context
  };
  console.info(JSON.stringify(logEntry));
}
```

**Why useful**: Easy to parse for log aggregation tools.

---

### `services/processor-worker/` - Event Processor

**Purpose**: Polls queue, stores events in ClickHouse and S3.

#### `src/index.ts` - Entry Point
**What it does**: Initializes ClickHouse, S3, queue, starts worker.

**Key Code**:
```typescript
const clickhouse = new ClickHouseStorage(config);
await clickhouse.initialize(); // Creates tables

const s3 = new S3Storage(config);
await s3.initialize(); // Creates bucket

const queue = createQueue();
const worker = new ProcessorWorker(clickhouse, s3, queue);
await worker.start(); // Starts polling loop
```

**Connections**:
- Initializes: ClickHouse, S3, Queue
- Starts: `worker.ts`

#### `src/worker.ts` - Main Processing Logic
**What it does**: Polls queue, processes events, stores them.

**Key Code**:
```typescript
private pollLoop() {
  // Poll every 1 second
  const messages = await this.queue.poll(10);
  
  for (const message of messages) {
    await this.processMessage(message);
    await this.queue.deleteMessage(message.messageId);
  }
  
  setTimeout(() => this.pollLoop(), 1000);
}

private async processDecisionEvent(event: XRDecisionEvent) {
  // 1. Store full payload in S3
  const s3Key = await this.s3.storeDecisionEvent(event);
  
  // 2. Store reference in ClickHouse
  await this.clickhouse.storeDecisionEventReference(event, s3Key);
  
  // 3. Track for aggregation
  this.stepDecisionEvents.get(stepId).push(event);
}
```

**How it works**:
1. Polls queue every second (gets up to 10 messages)
2. For each event: stores in S3 + ClickHouse
3. When step completes: aggregates metrics
4. When run completes: aggregates run metrics

**Why useful**: 
- Decouples ingestion from processing
- Handles bursts (queues events)
- Idempotent (safe retries)

**Connections**:
- Uses: `clickhouse.ts`, `s3.ts`, `queue.ts`
- Processes: Events from `ingestion-api`

#### `src/clickhouse.ts` - Analytics Storage
**What it does**: Stores aggregated metrics in ClickHouse.

**Key Code**:
```typescript
async initialize() {
  // Create runs table
  await this.client.exec(`
    CREATE TABLE runs (
      run_id String,
      total_steps UInt32,
      total_input_count UInt64,
      total_output_count UInt64,
      overall_elimination_ratio Float64,
      ...
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (run_id)
  `);
}

async storeStepMetrics(metrics: StepMetrics) {
  await this.client.insert({
    table: 'steps',
    values: [{
      step_id: metrics.stepId,
      input_count: metrics.inputCount,
      output_count: metrics.outputCount,
      elimination_ratio: metrics.eliminationRatio,
      ...
    }]
  });
}
```

**How it works**:
- Creates 3 tables: `runs`, `steps`, `decision_events`
- Stores aggregated metrics (counts, ratios)
- Uses ReplacingMergeTree (idempotent inserts)

**Why useful**: 
- Fast queries (columnar storage)
- Aggregated data (not raw JSON)
- Partitioned by month (efficient)

**Connections**:
- Used by: `worker.ts` (stores metrics)
- Queried by: `query-api` (reads metrics)

#### `src/s3.ts` - Raw Payload Storage
**What it does**: Stores full event JSON in S3 with deterministic keys.

**Key Code**:
```typescript
private getDecisionEventKey(event: XRDecisionEvent): string {
  const date = event.timestamp;
  return `decisions/${date.getFullYear()}/${month}/${day}/${event.id}.json`;
}

async storeDecisionEvent(event: XRDecisionEvent): Promise<string> {
  const key = this.getDecisionEventKey(event);
  const payload = JSON.stringify(event);
  
  // Check if exists (idempotency)
  try {
    await this.client.statObject(this.bucketName, key);
    return key; // Already exists
  } catch {
    await this.client.putObject(this.bucketName, key, Buffer.from(payload));
    return key;
  }
}
```

**How it works**:
- Generates deterministic key from event ID + date
- Stores full JSON payload
- Checks if exists before upload (idempotent)

**Why useful**: 
- Cheap storage (S3)
- Full traceability (complete event data)
- Idempotent (same event → same key)

**Connections**:
- Used by: `worker.ts` (stores raw payloads)
- Read by: `query-api` (fetches on demand)

#### `src/queue.ts` - Queue Client
**What it does**: Polls queue for messages.

**Key Code**:
```typescript
export interface EventQueue {
  poll(maxMessages?: number): Promise<QueueMessage[]>;
  deleteMessage(messageId: string): Promise<void>;
}

export class HttpQueue implements EventQueue {
  async poll(maxMessages = 10) {
    const response = await fetch(`${this.baseUrl}/poll`, {
      method: 'POST',
      body: JSON.stringify({ maxMessages })
    });
    return (await response.json()).messages;
  }
}
```

**Connections**:
- Used by: `worker.ts` (polls for events)
- Connects to: Queue service or Redis

---

### `services/query-api/` - Analytics API

**Purpose**: Queries ClickHouse and S3, returns analytics.

#### `src/index.ts` - Entry Point
**What it does**: Starts Express server on port 3001.

**Key Code**:
```typescript
const clickhouse = new ClickHouseQuery(config);
const s3 = new S3Client(config);

app.use('/runs', createRunRoutes(clickhouse, s3));
app.use('/steps', createStepRoutes(clickhouse, s3));
app.listen(3001);
```

**Connections**:
- Uses: `clickhouse.ts`, `s3.ts`, `routes/runs.ts`, `routes/steps.ts`
- Called by: Dashboard

#### `src/clickhouse.ts` - Query Client
**What it does**: Executes SQL queries against ClickHouse.

**Key Code**:
```typescript
async queryRuns(badFilter: boolean, limit: number) {
  let query = `SELECT * FROM runs FINAL`;
  
  if (badFilter) {
    query += ` WHERE overall_elimination_ratio > 0.8 
                OR status = 'failed'`;
  }
  
  query += ` ORDER BY started_at DESC LIMIT ${limit}`;
  
  const result = await this.client.query({ query });
  return await result.json();
}
```

**How it works**:
- Builds explicit SQL queries
- No joins (denormalized data)
- Uses FINAL keyword (gets latest from ReplacingMergeTree)

**Why useful**: 
- Fast queries (no joins)
- Explicit SQL (easy to understand)
- Filterable (bad runs, by date, etc.)

**Connections**:
- Used by: `routes/runs.ts`, `routes/steps.ts`
- Queries: Tables created by `processor-worker/clickhouse.ts`

#### `src/routes/runs.ts` - Run Endpoints
**What it does**: Handles GET /runs and GET /runs/:id.

**Key Code**:
```typescript
router.get('/', async (req, res) => {
  const badFilter = req.query.bad_filter === 'true';
  const rows = await clickhouse.queryRuns(badFilter, 100, 0);
  
  res.json({ data: rows.map(row => ({
    id: row.run_id,
    metrics: {
      totalSteps: row.total_steps,
      eliminationRatio: row.overall_elimination_ratio
    }
  }))});
});

router.get('/:id', async (req, res) => {
  const run = await clickhouse.getRunById(req.params.id);
  const steps = await clickhouse.getStepsByRunId(req.params.id);
  
  // Optionally fetch raw payload
  if (req.query.include_raw === 'true') {
    const raw = await s3.getRun(s3Key);
  }
  
  res.json({ data: { ...run, steps } });
});
```

**How it works**:
1. Queries ClickHouse for metrics
2. Optionally fetches raw payload from S3
3. Returns JSON response

**Why useful**: 
- Fast by default (ClickHouse only)
- Detailed on demand (S3 when needed)
- Clear response shapes

**Connections**:
- Uses: `clickhouse.ts` (queries), `s3.ts` (raw payloads)
- Called by: Dashboard

#### `src/s3.ts` - S3 Reader
**What it does**: Fetches raw payloads from S3.

**Key Code**:
```typescript
async getDecisionEvent(s3Key: string): Promise<XRDecisionEvent> {
  const dataStream = await this.client.getObject(this.bucketName, s3Key);
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    dataStream.on('data', chunk => chunks.push(chunk));
    dataStream.on('end', () => {
      resolve(JSON.parse(Buffer.concat(chunks).toString()));
    });
  });
}
```

**Connections**:
- Used by: `routes/runs.ts`, `routes/steps.ts`
- Reads: Files stored by `processor-worker/s3.ts`

---

## 🖥️ APPS - Frontend

### `apps/dashboard/` - Next.js Dashboard

**Purpose**: Visualizes runs, steps, decisions.

#### `src/lib/api.ts` - API Client
**What it does**: Fetches data from Query API.

**Key Code**:
```typescript
export async function fetchRuns(badFilter = false) {
  const url = `${API_BASE_URL}/runs${badFilter ? '?bad_filter=true' : ''}`;
  const response = await fetch(url, { cache: 'no-store' });
  return (await response.json()).data;
}
```

**Connections**:
- Calls: Query API (`services/query-api`)
- Used by: Dashboard pages

#### `src/app/runs/page.tsx` - Runs List
**What it does**: Displays table of all runs.

**Key Code**:
```typescript
export default async function RunsPage() {
  const runs = await fetchRuns(false);
  
  return (
    <table>
      {runs.map(run => (
        <tr style={{
          backgroundColor: run.metrics.eliminationRatio > 0.8 
            ? '#fff3cd'  // Yellow highlight
            : 'transparent'
        }}>
          <td>{run.id}</td>
          <td>{(run.metrics.eliminationRatio * 100).toFixed(1)}%</td>
        </tr>
      ))}
    </table>
  );
}
```

**How it works**:
- Fetches runs from Query API
- Highlights problematic runs (high elimination ratio)
- Links to run detail pages

**Connections**:
- Uses: `lib/api.ts` (fetches data)
- Links to: `/runs/[id]` page

#### `src/app/runs/[id]/page.tsx` - Run Detail
**What it does**: Shows step timeline for a run.

**Key Code**:
```typescript
export default async function RunDetailPage({ params }) {
  const run = await fetchRun(params.id);
  
  return (
    <div>
      <h1>Run: {run.id}</h1>
      <table>
        {run.steps.map(step => (
          <tr style={{
            backgroundColor: step.metrics.eliminationRatio > 0.8
              ? '#fff3cd'  // Highlight problematic step
              : 'transparent'
          }}>
            <td>{step.name}</td>
            <td>{step.metrics.eliminationRatio * 100}%</td>
            <td><Link href={`/runs/${run.id}/steps/${step.id}`}>View</Link></td>
          </tr>
        ))}
      </table>
    </div>
  );
}
```

**Connections**:
- Uses: `lib/api.ts` (fetches run)
- Links to: `/runs/[id]/steps/[stepId]` page

---

## 🔗 HOW FILES CONNECT

### Data Flow Chain:

```
1. Your App (demo/bad-pipeline.ts)
   ↓ imports
2. SDK (packages/sdk-core/src/XRay.ts)
   ↓ uses
3. Buffer (packages/sdk-core/src/buffer.ts)
   ↓ calls
4. Transport (packages/sdk-core/src/transport.ts)
   ↓ HTTP POST
5. Ingestion API (services/ingestion-api/src/routes/ingest.ts)
   ↓ validates with
6. Validation (services/ingestion-api/src/validation.ts)
   ↓ uses types from
7. Shared Types (packages/shared-types/src/types.ts)
   ↓ queues via
8. Queue (services/ingestion-api/src/queue.ts)
   ↓ polled by
9. Processor Worker (services/processor-worker/src/worker.ts)
   ↓ stores in
10. ClickHouse (services/processor-worker/src/clickhouse.ts)
    ↓ and
11. S3 (services/processor-worker/src/s3.ts)
    ↓ queried by
12. Query API (services/query-api/src/clickhouse.ts)
    ↓ returns to
13. Dashboard (apps/dashboard/src/lib/api.ts)
    ↓ displays in
14. Dashboard Pages (apps/dashboard/src/app/runs/page.tsx)
```

### Key Connections:

**Type System**:
- `packages/shared-types/src/types.ts` → Imported by ALL services
- Ensures consistency across entire system

**SDK → Ingestion**:
- `packages/sdk-core/src/transport.ts` → `services/ingestion-api/src/routes/ingest.ts`
- HTTP POST with events

**Ingestion → Queue**:
- `services/ingestion-api/src/routes/ingest.ts` → `services/ingestion-api/src/queue.ts`
- Validates then queues

**Queue → Processor**:
- `services/processor-worker/src/queue.ts` → `services/processor-worker/src/worker.ts`
- Polls queue, processes events

**Processor → Storage**:
- `services/processor-worker/src/worker.ts` → `clickhouse.ts` + `s3.ts`
- Dual write: metrics + raw payloads

**Storage → Query**:
- `services/query-api/src/clickhouse.ts` → Reads from ClickHouse
- `services/query-api/src/s3.ts` → Reads from S3 (on demand)

**Query → Dashboard**:
- `apps/dashboard/src/lib/api.ts` → `services/query-api/src/routes/runs.ts`
- HTTP GET requests

---

## 🎯 WHY THIS ARCHITECTURE?

**Separation of Concerns**:
- SDK: Captures events (non-blocking)
- Ingestion: Validates and queues (stateless)
- Processor: Stores data (idempotent)
- Query: Serves analytics (fast)
- Dashboard: Visualizes (read-only)

**Scalability**:
- Queue decouples ingestion from processing
- ClickHouse handles high query volume
- S3 stores unlimited raw data

**Debuggability**:
- Full trace: Run → Step → Decision Event
- Metrics for quick scanning
- Raw payloads for deep dive

**Reliability**:
- Idempotent processing (safe retries)
- Silent failures (never crashes app)
- Dual storage (fast + detailed)

