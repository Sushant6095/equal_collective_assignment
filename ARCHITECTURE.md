# X-Ray Architecture

## Overview

X-Ray tracks decisions made in multi-step pipelines. When a pipeline produces wrong results, you need to see which step eliminated which items and why.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   SDK       │────▶│  Ingestion   │────▶│  Processor  │────▶│   Query     │
│  (App)      │     │     API      │     │   Worker    │     │     API     │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │                     │                   │
                           ▼                     ▼                   ▼
                    ┌──────────────┐     ┌──────────────┐   ┌──────────────┐
                    │   Queue      │     │ ClickHouse   │   │ ClickHouse   │
                    │  (Redis)     │     │  (Metrics)   │   │  (Queries)   │
                    └──────────────┘     └──────────────┘   └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │   AWS S3     │
                                         │ (Raw Events) │
                                         └──────────────┘
```

## Data Model Rationale

### Why Three Entities?

**Runs, Steps, Decision Events** - Each serves a different query pattern:

- **Runs**: "Show me all pipeline executions from last week"
- **Steps**: "Which step eliminated the most items?"
- **Decision Events**: "Why was candidate X eliminated at step Y?"

### Dual Storage Strategy

**ClickHouse (aggregated) + S3 (raw)**

ClickHouse stores:
- Run metrics: total steps, input/output counts, elimination ratio
- Step metrics: input/output counts, kept/eliminated/scored counts
- Decision references: event ID, outcome, S3 key (not full payload)

S3 stores:
- Full decision event payloads (input, output, reason, metadata)
- Full run and step payloads

**Why?** ClickHouse queries are fast but expensive to store large JSON. S3 is cheap but slow to query. Most queries need metrics, not full payloads. Fetch from S3 only when debugging specific decisions.

### Decision Outcomes: kept | eliminated | scored

These map directly to pipeline behavior:
- **kept**: Item continues to next step
- **eliminated**: Item removed, won't continue
- **scored**: Item ranked but outcome depends on threshold

This enables queries like "show all eliminated items" without parsing reasons.

## Debugging Walkthrough

### Scenario: Pipeline eliminated 90% of candidates (should be 40%)

1. **Dashboard shows high elimination ratio** → Click run
2. **Step timeline shows** → "filter-by-keywords" has 85% elimination
3. **Click step** → See decision events
4. **Decision events show** → "Missing required keywords: security, compliance"
5. **Root cause** → Filter requires ALL keywords instead of SOME

### Why This Works

Each decision event records:
- **itemId**: Track same item across steps
- **reason**: Human-readable explanation
- **input/output**: What was evaluated and result
- **s3Key**: Link to full payload if needed

The step timeline aggregates these into metrics (input count, output count, elimination ratio) for quick scanning.

## Queryability

### No Joins Across Large Tables

Each query targets one table:

```sql
-- Get runs (no join)
SELECT * FROM runs WHERE overall_elimination_ratio > 0.8;

-- Get steps for a run (no join, run_id is in steps table)
SELECT * FROM steps WHERE run_id = 'run-123';

-- Get decision events for a step (no join, step_id is in events table)
SELECT * FROM decision_events WHERE step_id = 'step-456';
```

**Why?** ClickHouse is columnar. Joins are expensive. Denormalize run_id and step_id into each table.

### Deterministic S3 Keys

S3 keys: `decisions/2024/01/15/event-123.json`

- Date partitioning enables efficient range queries
- Event ID ensures idempotency (same event → same key)
- No database lookup needed to fetch raw payload

## Performance Trade-offs

### Sampling

SDK supports three capture levels:
- **metrics_only**: Counts only, no events
- **sampled**: Adaptive sampling (5000 → 5)
- **full**: All events

**Trade-off**: Full capture is expensive. Sampling reduces data volume but may miss edge cases. Default to sampled, use full for debugging.

### Async Buffering

SDK buffers events and sends in batches. Never blocks application logic.

**Trade-off**: Events may be lost on crash before flush. Acceptable for observability (not critical business data).

### ClickHouse Partitioning

Tables partitioned by month: `PARTITION BY toYYYYMM(timestamp)`

**Trade-off**: Queries spanning months hit multiple partitions. Monthly partitions balance query performance with partition count.

### ReplacingMergeTree

ClickHouse uses `ReplacingMergeTree` engine. Duplicate inserts are safe (idempotent).

**Trade-off**: Background merge process may delay seeing latest data. Use `FINAL` keyword in queries for immediate consistency (slower) or accept eventual consistency (faster).

## Developer Experience

### SDK API

```typescript
const runId = await xray.startRun('pipeline-1', input);
const result = await xray.step(runId, XRStepType.FILTER, 'filter-step', 
  async (input) => {
    // Business logic returns items with decisions
    return items.map(item => ({
      itemId: item.id,
      outcome: item.score > threshold ? KEPT : ELIMINATED,
      reason: `Score ${item.score} vs threshold ${threshold}`,
      // ...
    }));
  },
  input
);
await xray.endRun(runId, result);
```

**Design**: Business logic returns decision metadata. SDK handles tracking automatically. No manual event emission.

### Silent Failures

SDK never throws errors. If ingestion API is down, events are dropped silently.

**Trade-off**: Application continues running but loses observability. Prefer application stability over observability guarantees.

## Future Improvements

### Current Limitations

1. **In-memory aggregation**: Processor worker caches runs/steps in memory. Multiple workers can't share state. **Fix**: Use Redis for shared aggregation state.

2. **No joins**: Can't query "all decisions for items eliminated in step X". **Fix**: Add materialized view or denormalize item_id into decision_events.

3. **Sampling may miss edge cases**: Rare but important decisions might not be sampled. **Fix**: Always sample first/last items, add explicit "important" flag.

4. **No alerting**: High elimination ratios aren't automatically flagged. **Fix**: Add alerting service that queries ClickHouse metrics.

5. **S3 key lookup**: To fetch raw payload, must construct S3 key from event metadata. **Fix**: Store S3 key in ClickHouse decision_events table (already done).

### Production Considerations

- **Authentication**: All services currently unauthenticated
- **Rate limiting**: Ingestion API has no rate limits
- **Retry logic**: Simple exponential backoff, no circuit breaker
- **Monitoring**: Basic health checks, no metrics export
- **Scaling**: Single worker instance, no horizontal scaling

## Component Responsibilities

**SDK**: Captures decisions, buffers, sends to ingestion API. Never blocks.

**Ingestion API**: Validates events, pushes to queue. Stateless.

**Processor Worker**: Polls queue, stores in ClickHouse (metrics) and S3 (raw). Idempotent.

**Query API**: Queries ClickHouse for metrics, fetches from S3 for raw payloads. Fast by default, detailed on demand.

**Dashboard**: Visualizes runs, steps, decisions. Highlights problematic steps (high elimination ratio).

---

**Core Principle**: Fast queries for common cases (metrics), detailed data available when needed (raw payloads). No joins, explicit queries, clear data flow.

