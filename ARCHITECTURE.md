# X-Ray Architecture

## System Overview

X-Ray is a decision observability system for multi-step pipelines. It tracks every decision (keep, eliminate, score) made during pipeline execution, enabling rapid debugging when pipelines produce incorrect results.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   SDK       │────▶│  Ingestion   │────▶│  Processor  │────▶│   Query     │
│  (App)      │     │     API      │     │   Worker    │     │     API     │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │                     │                   │
                           ▼                     ▼                   ▼
                    ┌──────────────┐     ┌──────────────┐   ┌──────────────┐
                    │   Queue      │     │ ClickHouse   │   │ ClickHouse   │
                    │  (RabbitMQ)  │     │  (Metrics)    │   │  (Queries)   │
                    └──────────────┘     └──────────────┘   └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │   AWS S3     │
                                         │ (Raw Events) │
                                         └──────────────┘
```

## Data Model Rationale

### Three-Entity Design: Runs → Steps → Decision Events

**Why this structure?**

Each entity serves distinct query patterns without requiring joins:

- **Runs**: "Show all pipeline executions from last week" → Single table scan
- **Steps**: "Which step eliminated the most items?" → Filter by `run_id` (denormalized)
- **Decision Events**: "Why was item X eliminated?" → Filter by `step_id` (denormalized)

**Alternatives considered:**

1. **Single flat table**: Would require massive denormalization, slow queries, high storage costs
2. **Graph database**: Overkill for this use case, adds complexity, slower for analytics
3. **Document store (MongoDB)**: Poor analytics performance, expensive joins

**What breaks with different choices?**

- Without denormalization: Every query requires joins → 10-100x slower in ClickHouse
- Without separate tables: Can't efficiently query "all runs" without scanning all decision events
- Without S3 separation: ClickHouse storage costs explode (10x+), query performance degrades

### Dual Storage Strategy: ClickHouse + S3

**ClickHouse** stores aggregated metrics:
- Run metrics: `total_steps`, `total_input_count`, `overall_elimination_ratio`
- Step metrics: `input_count`, `output_count`, `elimination_ratio`, `kept_count`, `eliminated_count`
- Decision references: `event_id`, `outcome`, `item_id`, `s3_key` (not full payload)

**S3** stores full payloads:
- Complete decision events (input, output, reason, metadata)
- Complete run and step payloads

**Why?** ClickHouse queries are fast but expensive for large JSON. S3 is cheap ($0.023/GB/month) but slow to query. Most queries need metrics, not full payloads. Fetch from S3 only when debugging specific decisions.

**Trade-off:** Two storage systems add complexity, but enables fast queries (ClickHouse) + cheap storage (S3) simultaneously.

### Decision Outcomes: `kept | eliminated | scored`

These map directly to pipeline behaviour:
- **kept**: Item continues to next step
- **eliminated**: Item removed, won't continue
- **scored**: Item ranked but outcome depends on threshold

This enables queries like "show all eliminated items" without parsing reasons. Alternative: Store only reasons → requires regex/text parsing for every query → slow.

## Debugging Walkthrough

### Scenario: Phone case matched to laptop stand

**Step 1: Dashboard shows suspicious run**
- Query: `SELECT * FROM runs WHERE overall_elimination_ratio > 0.8`
- Result: Run `run-123` has 85% elimination (expected: 40%)

**Step 2: Inspect step timeline**
- Query: `SELECT * FROM steps WHERE run_id = 'run-123' ORDER BY started_at`
- Result: Step `step-456` ("filter-by-keywords") eliminated 75% of items

**Step 3: View decision events**
- Query: `SELECT * FROM decision_events WHERE step_id = 'step-456' AND outcome = 'kept' LIMIT 10`
- Result: Phone case kept with reason "Matches all keywords: phone, case..."

**Step 4: Fetch full payload from S3**
- Query: `GET s3://bucket/decisions/2024/01/15/event-789.json`
- Result: Shows input keywords were ["laptop", "stand"] but phone case matched → bug found

**Step 5: Track item across all steps**
- Query: `SELECT * FROM decision_events WHERE item_id = 'phone-case-123' ORDER BY timestamp`
- Result: Shows phone case incorrectly passed through keyword filter

**Why this works:** Each decision event records `itemId` (tracks same item across steps), `reason` (human-readable explanation), `s3Key` (link to full payload). The step timeline aggregates these into metrics for quick scanning.

## Queryability

### Cross-Pipeline Queries

**Question:** "Show me all runs where the filtering step eliminated more than 90% of candidates"—regardless of which pipeline.

**Solution:** Query steps table directly:

```sql
SELECT run_id, pipeline_id, step_name, elimination_ratio
FROM steps
WHERE step_type = 'filter' 
  AND elimination_ratio > 0.9
ORDER BY elimination_ratio DESC
```

**Why this works:**
- `step_type` is standardized (Enum: `filter`, `rank`, `llm`, `transform`, `score`)
- `elimination_ratio` is computed consistently: `(input_count - output_count) / input_count`
- `pipeline_id` is stored in steps table (denormalized) → no join needed

**Constraints imposed on developers:**
1. **Step type must be accurate**: Use `XRStepType.FILTER` for filtering steps, not `TRANSFORM`
2. **Step name should be descriptive**: "filter-by-keywords" not "step1"
3. **Consistent outcome semantics**: `eliminated` means item removed, `kept` means item continues

**Variability across use cases:**

The system is pipeline-agnostic. Different pipelines (competitor selection, listing optimization, categorization) can have:
- Different step sequences (some have 3 steps, others have 10)
- Different step types (some use LLM steps, others don't)
- Different metadata (competitor selection tracks revenue, categorization tracks categories)

**How query ability handles this:**
- **Standardized metrics**: All steps compute `elimination_ratio` the same way
- **Extensible metadata**: `config` field stores pipeline-specific data (not used in queries)
- **Flexible step types**: The enum can be extended without breaking queries
- **Pipeline ID**: Allows filtering by pipeline when needed: `WHERE pipeline_id = 'competitor-selection'`

**Example cross-pipeline query:**
```sql
-- Find all filtering steps across all pipelines that eliminated >90%
SELECT pipeline_id, step_name, elimination_ratio, input_count
FROM steps
WHERE step_type = 'filter' AND elimination_ratio > 0.9
ORDER BY elimination_ratio DESC
```

This works because the data model abstracts away pipeline-specific details into standardized metrics.

## Performance & Scale

### The 5,000 → 30 Problem

**Scenario:** A step takes 5,000 candidates as input and filters down to 30. Capturing full details for all 5,000 (including rejection reasons) might be prohibitively expensive.

**Solution: Adaptive Sampling**

The SDK supports three capture levels:

1. **`METRICS_ONLY`**: Counts only, no events
   - Stores: `input_count=5000`, `output_count=30`, `elimination_ratio=0.994`
   - Cost: ~100 bytes per step
   - Use case: Production monitoring, high-volume pipelines

2. **`SAMPLED`**: Adaptive sampling (5000 → ~5 events)
   - Always samples: first item, last item (boundary cases)
   - Uniformly samples middle items to reach target size
   - Stores: 5 decision events + metrics
   - Cost: ~5KB per step (99.9% reduction)
   - Use case: Default for most pipelines

3. **`FULL`**: All events
   - Stores: All 5,000 decision events
   - Cost: ~500KB per step
   - Use case: Debugging specific issues, low-volume critical pipelines

**Trade-offs:**

| Level | Completeness | Performance | Storage Cost | Use Case |
|-------|-------------|-------------|--------------|----------|
| METRICS_ONLY | Low (counts only) | Fastest | Lowest | Production monitoring |
| SAMPLED | Medium (representative sample) | Fast | Low | Default |
| FULL | High (all events) | Slower | High | Debugging |

**Who decides?** The developer sets `captureLevel` in SDK config. The system enforces it consistently.

**What if sampling misses important edge cases?**

- Always samples first/last items (catches boundary conditions)
- Developer can mark items as "important" via `decisionCallback` → always captured
- For critical debugging, temporarily set `captureLevel=FULL`

**Storage cost example:**
- 1M runs/day, 5 steps/run, 5000 items/step
- METRICS_ONLY: ~500MB/day
- SAMPLED: ~25GB/day
- FULL: ~2.5TB/day

**Recommendation:** Use SAMPLED by default, FULL for debugging, METRICS_ONLY for high-volume production.

## Developer Experience

### Minimal Instrumentation

**What's the minimal change to get something useful?**

```typescript
const xray = new XRay({ apiUrl: 'http://localhost:3000' });
const runId = await xray.startRun('my-pipeline', input);

// Wrap existing function - NO CODE CHANGES!
const result = await xray.step(
  runId,
  XRStepType.FILTER,
  'filter-step',
  async (items) => {
    return items.filter(item => item.score > threshold); // Your existing code
  },
  items
);

await xray.endRun(runId, result);
```

**What you get:**
- Automatic metrics: input count, output count, elimination ratio
- Automatic decision detection: SDK compares input vs output arrays
- Sampled decision events (default: 5 events for large batches)

**Time to instrument:** ~5 minutes per pipeline.

### Full Instrumentation

**What does full instrumentation look like?**

```typescript
const result = await xray.step(
  runId,
  XRStepType.FILTER,
  'filter-by-keywords',
  async (items) => {
    return items.filter(item => matchesKeywords(item));
  },
  items,
  { keywords: ['security', 'compliance'], matchType: 'all' }, // Config
  (item, result, index) => { // Custom decision callback
    if (!result) {
      return {
        outcome: XRDecisionOutcome.ELIMINATED,
        reason: `Missing keywords: ${getMissingKeywords(item)}`,
      };
    }
    return {
      outcome: XRDecisionOutcome.KEPT,
      reason: `Matches all keywords`,
    };
  }
);
```

**What you get:**
- Custom decision reasons (not generic "item eliminated")
- Step configuration captured (keywords, thresholds)
- Full control over what gets tracked

**Time to instrument:** ~30 minutes per pipeline (adds custom decision callbacks).

### X-Ray Backend Unavailable

**What happens if the ingestion API is down?**

The SDK **never throws errors**. All operations are fire-and-forget:

1. Events are buffered in memory (up to 10,000 events)
2. SDK retries with exponential backoff (3 attempts)
3. If all retries fail, events are **silently dropped**
4. Application continues running normally

**Trade-off:** Application stability over observability guarantees. Prefer application continues running even if observability is temporarily unavailable.

**Current behaviour:** Acceptable for observability (not critical business data). For critical data, add persistent buffer.

**What about events in buffer when app crashes?**

Events in buffer are lost. For production, consider:
- Periodic buffer flushes (every 5 seconds)
- Graceful shutdown: `await xray.flush()` before exit
- Persistent buffer (Redis) for critical pipelines

**Current behavior:** Acceptable for observability (not critical business data). For critical data, add persistent buffer.

## Real-World Application

### E-commerce Product Search Pipeline

**System:** Product search that filters, ranks, and personalizes results across multiple steps:
1. Filter by category
2. Filter by price range
3. Rank by relevance score
4. Personalize based on user history

**Problem:** Users reported irrelevant products appearing in search results (e.g., "laptop stand" showing "phone case").

**Without X-Ray:**
- Added logging everywhere → logs too verbose, hard to trace specific searches
- Manual debugging: Reproduce issue → add breakpoints → trace through code → 2-3 hours per issue
- Production issues: No visibility into why bad results appeared

**With X-Ray:**
1. Open dashboard → Filter runs by high elimination ratio
2. Click suspicious run → See step timeline
3. Click "filter-by-category" step → See decision events
4. Find phone case event → See reason: "Category matched: 'laptop accessories'"
5. Root cause: Category mapping bug (phone cases mapped to laptop accessories)
6. Fix time: 10 minutes (vs 2-3 hours)

**How to retrofit:**

```typescript
// Before
async function searchProducts(query, filters) {
  let results = allProducts;
  results = filterByCategory(results, filters.category);
  results = filterByPrice(results, filters.priceRange);
  results = rankByRelevance(results, query);
  results = personalize(results, user);
  return results;
}

// After (minimal instrumentation)
async function searchProducts(query, filters) {
  const xray = new XRay({ apiUrl: process.env.XRAY_API_URL });
  const runId = await xray.startRun('product-search', { query, filters });
  
  let results = allProducts;
  results = await xray.step(runId, XRStepType.FILTER, 'filter-by-category',
    () => filterByCategory(results, filters.category), results);
  results = await xray.step(runId, XRStepType.FILTER, 'filter-by-price',
    () => filterByPrice(results, filters.priceRange), results);
  results = await xray.step(runId, XRStepType.RANK, 'rank-by-relevance',
    () => rankByRelevance(results, query), results);
  results = await xray.step(runId, XRStepType.TRANSFORM, 'personalize',
    () => personalize(results, user), results);
  
  await xray.endRun(runId, results);
  return results;
}
```

**Time to retrofit:** ~15 minutes. Zero changes to business logic.

## API Specification

### Ingestion API (`POST /ingest`)

**Request:**
```json
{
  "type": "decision" | "decisions" | "run" | "step",
  "data": { /* XRDecisionEvent | XRDecisionEvent[] | XRRun | XRStep */ }
}
```

**Response:**
```json
{
  "success": true,
  "queued": true
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Validation error message",
  "details": { /* Zod error details */ }
}
```

### Query API

**GET `/runs`**
- Query params: `bad_filter` (boolean), `limit` (number), `offset` (number)
- Response: `{ success: true, data: RunListItem[], count: number }`

**GET `/runs/:id`**
- Query params: `include_raw` (boolean)
- Response: `{ success: true, data: RunDetail }`

**GET `/steps/:id/details`**
- Query params: `include_raw` (boolean), `decision_limit` (number)
- Response: `{ success: true, data: StepDetail }`

**Response Shapes:**

```typescript
interface RunListItem {
  id: string;
  pipelineId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  metrics: {
    totalSteps: number;
    totalInputCount: number;
    totalOutputCount: number;
    overallEliminationRatio: number;
  };
}

interface StepDetail {
  id: string;
  runId: string;
  type: string;
  name: string;
  metrics: {
    inputCount: number;
    outputCount: number;
    eliminationRatio: number;
    keptCount: number;
    eliminatedCount: number;
    scoredCount: number;
  };
  decisionEvents: DecisionEventReference[];
  rawPayload?: unknown;
}
```

## What Next?

### Production Readiness

1. **Authentication & Authorization**
   - Add API keys for ingestion API
   - Role-based access control for query API
   - Tenant isolation (multi-tenant support)

2. **Rate Limiting**
   - Per-client rate limits on ingestion API
   - Query API rate limits to prevent abuse
   - Burst handling (queue-based)

3. **Monitoring & Alerting**
   - Metrics export (Prometheus)
   - Alert on high elimination ratios
   - Dashboard for system health

4. **Scalability**
   - Horizontal scaling for processor workers
   - Redis for shared aggregation state (replaces in-memory cache)
   - ClickHouse cluster for high query volume

5. **Data Retention**
   - Automatic S3 lifecycle policies (delete after 90 days)
   - ClickHouse TTL for old metrics
   - Archive to Glacier for compliance

6. **Advanced Features**
   - **Item-level tracing**: Query all decisions for a specific item across all runs
   - **Comparative analysis**: Compare elimination ratios across pipeline versions
   - **Anomaly detection**: Auto-flag runs with unusual patterns
   - **Export/Import**: Export runs for offline analysis

### Technical Debt

1. **In-memory aggregation**: Processor worker caches runs/steps in memory → multiple workers can't share state. **Fix**: Use Redis for shared aggregation state.

2. **No item-level queries**: Can't efficiently query "all decisions for item X across all runs". **Fix**: Add materialized view or denormalize `item_id` into `decision_events` table with index.

3. **Sampling may miss edge cases**: Rare but important decisions might not be sampled. **Fix**: Always sample first/last items, add explicit "important" flag in SDK.

4. **No alerting**: High elimination ratios aren't automatically flagged. **Fix**: Add alerting service that queries ClickHouse metrics and sends notifications.

---

**Core Principle:** Fast queries for common cases (metrics), detailed data available when needed (raw payloads). No joins, explicit queries, clear data flow. System is pipeline-agnostic and scales from small pipelines to millions of runs per day.
