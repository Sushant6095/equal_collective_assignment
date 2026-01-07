# X-Ray Demo Pipelines

Demo pipelines to test and demonstrate X-Ray observability.

## Bad Pipeline - Competitor Selection

A deliberately problematic pipeline that over-filters candidates to demonstrate debugging capabilities.

### The Problem

The pipeline has two intentional bugs:

1. **Keyword Filter Too Strict**: Requires ALL keywords to match instead of SOME
   - Eliminates candidates that match most keywords but not all
   - Should use "any" or "some" matching instead

2. **Revenue Threshold Too High**: Sets threshold at $50M
   - Eliminates good candidates with revenue between $10M-$50M
   - Should be lower (e.g., $10M)

### Expected Behavior

- **Input**: 8 candidates
- **After Keyword Filter**: ~2-3 candidates (should be ~5-6)
- **After Revenue Filter**: ~1-2 candidates (should be ~4-5)
- **Final Output**: 1-2 competitors (should be 3-4)
- **Elimination Ratio**: ~75-85% (should be ~40-50%)

### Running the Demo

```bash
# IMPORTANT: Install from root directory (workspace setup)
# From project root:
npm install

# Then run the demo:
cd demo

# Set ingestion API URL (PowerShell)
$env:INGESTION_API_URL = "http://localhost:3000"

# Or (Bash/Linux)
# export INGESTION_API_URL=http://localhost:3000

# Run the pipeline
npm run bad-pipeline
```

### Viewing Results

1. Start the infrastructure:
   ```bash
   cd infra
   docker-compose up -d
   ```

2. Start the dashboard:
   ```bash
   cd apps/dashboard
   npm install
   npm run dev
   ```

3. View results:
   - Dashboard: http://localhost:3000/runs
   - Look for runs with high elimination ratio
   - Drill down to see which steps eliminated candidates

### Debugging in Dashboard

1. **Runs List**: Look for runs with elimination ratio > 80%
2. **Run Detail**: See step-by-step timeline
3. **Step Detail**: View decision events to see why candidates were eliminated
4. **Problem Indicators**:
   - High elimination ratio in keyword filter step
   - Many candidates eliminated for "missing required keywords"
   - Revenue filter eliminates candidates with good revenue

### Fixing the Pipeline

To fix the bugs:

1. **Keyword Filter**: Change from `every()` to `some()`:
   ```typescript
   const hasKeywords = searchKeywords.some((keyword) =>
     candidate.keywords.some((k) => k.includes(keyword))
   );
   ```

2. **Revenue Threshold**: Lower to $10M:
   ```typescript
   const threshold = 10000000; // $10M instead of $50M
   ```

