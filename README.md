# X-Ray: Decision Observability for Multi-Step Pipelines

> **Ever wonder why your pipeline made a bad decision?** X-Ray answers that question by tracking every decision your pipeline makes, so you can debug issues like "why did a phone case get matched to a laptop stand?" in minutes instead of hours.

## 🎯 What Problem Does This Solve?

Imagine you have a competitor selection pipeline that filters candidates through multiple steps:
1. Generate search keywords (LLM)
2. Filter by keywords
3. Filter by revenue
4. Rank by relevance

**The problem:** Your pipeline returns a bad match - a phone case matched against a laptop stand. How do you debug this?

**Traditional approach:** Add logging everywhere, manually trace through code, hope you catch the issue in production logs.

**X-Ray approach:** Open the dashboard, click the run, see which step made the bad decision, view the exact reason why, and fix it. Done in 2 minutes.

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Application                         │
│  (Competitor Selection, Product Search, Content Moderation...)  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ SDK (Lightweight Wrapper)
                             │ - Wraps your existing code
                             │ - Zero code changes needed
                             ▼
                    ┌────────────────┐
                    │  Ingestion API │  Port 3000
                    │  (Validates &  │
                    │   Queues)      │
                    └────────┬───────┘
                             │
                             │ Queue (Redis/Memory)
                             │
                             ▼
                    ┌────────────────┐
                    │ Processor      │
                    │ Worker         │
                    │ (Aggregates)   │
                    └───┬────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌───────────────┐            ┌──────────────────┐
│  ClickHouse   │            │   MinIO (S3)     │
│  (Metrics)    │            │  (Raw Payloads)  │
│               │            │                  │
│ - Runs        │            │ - Full events    │
│ - Steps       │            │ - Full payloads  │
│ - References  │            │ - Debug data     │
└───────┬───────┘            └──────────────────┘
        │
        │ Query API (Port 3001)
        │
        ▼
┌────────────────┐
│   Dashboard    │  Port 3000 (Next.js)
│  (Visualize)   │
└────────────────┘
```

## 🔄 Data Flow: How It Works

### Step 1: Your Code Calls the SDK

```typescript
const xray = new XRay({ apiUrl: 'http://localhost:3000' });
const runId = await xray.startRun('competitor-selection', input);

// Wrap your existing function - NO CODE CHANGES!
const result = await xray.step(
  runId,
  XRStepType.FILTER,
  'filter-by-keywords',
  async (candidates) => {
    // Your existing business logic
    return candidates.filter(c => matchesKeywords(c));
  },
  candidates
);
```

**What happens:** SDK automatically detects which items were kept/eliminated by comparing input vs output arrays.

### Step 2: SDK Sends Events to Ingestion API

```
SDK → HTTP POST /ingest → Ingestion API
```

**What gets sent:**
- Run metadata (pipeline ID, input, started time)
- Step metadata (step type, name, config)
- Decision events (item ID, outcome, reason, score)

**Key feature:** SDK never blocks your code. All operations are fire-and-forget.

### Step 3: Ingestion API Validates & Queues

```
Ingestion API → Validates → Queue (Redis/Memory)
```

**Why a queue?**
- Handles bursts of events
- Decouples ingestion from processing
- Enables retries if processing fails

### Step 4: Processor Worker Aggregates

```
Queue → Processor Worker → ClickHouse + S3
```

**What the worker does:**
1. Polls queue for events
2. Stores full payloads in S3 (cheap storage)
3. Aggregates metrics in ClickHouse (fast queries)
4. Calculates elimination ratios, counts, etc.

**Dual storage strategy:**
- **ClickHouse:** Fast queries on metrics (runs, steps, elimination ratios)
- **S3:** Cheap storage for full payloads (only fetched when debugging)

### Step 5: Query API Serves Data

```
ClickHouse → Query API → Dashboard
```

**Query patterns:**
- "Show me all runs with high elimination ratio" → Single table query
- "Which step eliminated the most items?" → Filter by run_id
- "Why was item X eliminated?" → Get decision events, fetch S3 payload

**Why it's fast:** No joins. We denormalize run_id and step_id into each table.

### Step 6: Dashboard Visualizes

```
Dashboard → Query API → ClickHouse/S3 → Beautiful UI
```

**What you see:**
- List of runs with metrics
- Step timeline showing elimination at each step
- Decision events with reasons
- Full payloads from S3 when debugging

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** - React framework for dashboard
- **TypeScript** - Type safety

### Backend Services
- **Node.js + Express** - Ingestion API, Query API
- **TypeScript** - Type safety across all services

### Data Storage
- **ClickHouse** - Columnar database for fast analytics queries
  - Stores aggregated metrics (runs, steps, decision references)
  - Partitioned by month for performance
  - ReplacingMergeTree engine for idempotent inserts
- **MinIO (S3-compatible)** - Object storage for raw payloads
  - Deterministic keys: `decisions/{year}/{month}/{day}/{eventId}.json`
  - Cheap storage, fetched only when debugging

### Message Queue
- **Redis** - Queue backend (or in-memory for local dev)
- **Simple polling** - Worker polls queue every second

### Infrastructure
- **Docker Compose** - Local development
- **npm workspaces** - Monorepo management

### SDK
- **TypeScript** - Type-safe SDK
- **Adaptive sampling** - Reduces 5000 events → 5 sampled events
- **Async buffering** - Batches events before sending
- **Silent failures** - Never breaks your application

## 📦 Deliverables

### ✅ Core System

1. **SDK (`packages/sdk-core/`)**
   - Lightweight wrapper around existing code
   - Automatic decision detection
   - Adaptive sampling (handles 5000 → 30 efficiently)
   - Non-blocking, never throws errors

2. **Ingestion API (`services/ingestion-api/`)**
   - Validates incoming events
   - Queues events for processing
   - Health checks

3. **Processor Worker (`services/processor-worker/`)**
   - Polls queue, processes events
   - Stores metrics in ClickHouse
   - Stores full payloads in S3
   - Idempotent processing (safe retries)

4. **Query API (`services/query-api/`)**
   - Queries ClickHouse for metrics
   - Fetches from S3 for full payloads
   - RESTful API for dashboard

5. **Dashboard (`apps/dashboard/`)**
   - Visualizes runs, steps, decisions
   - Highlights problematic steps
   - Shows decision reasons
   - Fetches full payloads on demand

### ✅ Data Model

**Three tables optimized for different queries:**

1. **`runs`** - Pipeline executions
   - Query: "Show me all runs from last week"
   - Pre-aggregated metrics (elimination ratio, step counts)

2. **`steps`** - Step-level metrics
   - Query: "Which step eliminated the most items?"
   - Denormalized run_id (no joins needed)

3. **`decision_events`** - Item-level decisions
   - Query: "Why was item X eliminated?"
   - Links to S3 for full payloads

**Why this design?**
- ClickHouse is columnar - joins are expensive
- Denormalize IDs into each table → single-table queries
- Dual storage (ClickHouse + S3) → fast queries + cheap storage

### ✅ Key Features

- **Zero code changes** - Wrap existing functions
- **Automatic decision detection** - Compares input/output arrays
- **Adaptive sampling** - 99.8% storage reduction (5000 → 5 events)
- **Silent failures** - SDK never breaks your app
- **Fast queries** - No joins, single-table scans
- **Full traceability** - Track any item through entire pipeline

## 🚀 Quick Start

### 1. Start Infrastructure

```bash
cd infra
docker-compose up -d
```

This starts:
- ClickHouse (port 8123)
- MinIO (ports 9001, 9002)
- Redis (port 6379)
- Ingestion API (port 3000)
- Query API (port 3001)
- Processor Worker

### 2. Run Demo Pipeline

```bash
# From root
cd demo
export INGESTION_API_URL=http://localhost:3000  # or $env:INGESTION_API_URL on Windows
npm run bad-pipeline
```

This runs a competitor selection pipeline with intentional bugs to demonstrate debugging.

### 3. View Dashboard

```bash
cd apps/dashboard
npm install
npm run dev
```

Open http://localhost:3000/runs and explore the runs, steps, and decisions.

## 📊 Example: Debugging a Bad Match

**Scenario:** Phone case incorrectly matched to laptop stand.

**Step 1:** Dashboard shows run with 85% elimination ratio (suspicious!)

**Step 2:** Click run → See step timeline. Step 2 "filter-by-keywords" has 75% elimination.

**Step 3:** Click step → See decision events. Phone case was kept with reason "Matches all keywords: phone, case..."

**Step 4:** But generated keywords were for "laptop stand"! Bug found - keyword matching is broken.

**Step 5:** Track item through all steps using `getDecisionEventsByItemId()` to see where it incorrectly passed through.

**Result:** Fixed the bug in 2 minutes instead of spending hours tracing through logs.

## 🎓 How It's Different From Tracing

| Aspect | Traditional Tracing (Jaeger, Zipkin) | X-Ray |
|--------|--------------------------------------|-------|
| **Focus** | Performance & flow | Decision reasoning |
| **Data** | Spans, timing, service calls | Candidates, filters, selection logic |
| **Question** | "What happened?" | "Why this output?" |
| **Granularity** | Function/service level | Business logic level |

**Example:**
- **Tracing:** "Function `filterProducts()` took 50ms, called `checkPrice()`"
- **X-Ray:** "Product 'laptop-123' was eliminated because price $2000 exceeds threshold $1500"

They complement each other - tracing for performance, X-Ray for correctness.

## 📁 Project Structure

```
equal-collective-sample/
├── packages/
│   ├── sdk-core/          # X-Ray SDK
│   └── shared-types/       # TypeScript types
├── services/
│   ├── ingestion-api/     # Receives events, queues them
│   ├── processor-worker/  # Processes events, stores data
│   └── query-api/         # Queries ClickHouse/S3
├── apps/
│   └── dashboard/         # Next.js dashboard
├── demo/                  # Demo pipelines
└── infra/                 # Docker Compose setup
```

## 🔧 Development

### Build Everything

```bash
npm install
npm run build
```

### Run Services Locally

```bash
# Ingestion API
cd services/ingestion-api
npm run dev

# Query API
cd services/query-api
npm run dev

# Processor Worker
cd services/processor-worker
npm run dev
```

### Run Tests

```bash
npm run test
```

## 📚 Documentation

- **ARCHITECTURE.md** - Detailed architecture and design decisions
- **CODEBASE_EXPLANATION.md** - Code walkthrough
- **HOW_TO_INTEGRATE.md** - Integration guide
- **INTEGRATION_EXAMPLES.md** - Code examples

## 🎯 Use Cases

X-Ray works for any multi-step pipeline:

- **Competitor Selection** - Track why candidates were filtered
- **Product Search** - Debug why irrelevant products appear
- **Content Moderation** - See why content was flagged
- **Fraud Detection** - Understand why transactions were blocked
- **Recommendation Systems** - Track why items were ranked

## 🤝 Contributing

This is a sample project demonstrating decision observability patterns. Feel free to use it as a reference for building your own observability system.

## 📝 License

MIT

---

**Built with ❤️ to make debugging pipelines less painful.**
