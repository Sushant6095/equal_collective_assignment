# X-Ray SDK Core

Core SDK for tracking decisions in multi-step pipelines with automatic observability.

## Features

- **Non-blocking**: Never blocks application logic
- **Automatic metrics**: Captures input/output counts automatically
- **Adaptive sampling**: Reduces data volume (e.g., 5000 → 5) while maintaining observability
- **Async buffering**: Batches events for efficient sending
- **Silent failures**: SDK failures never affect application execution
- **Capture levels**: `metrics_only`, `sampled`, or `full`

## Usage

```typescript
import { XRay, XRStepType, XRDecisionOutcome } from '@xray/sdk-core';

const xray = new XRay({
  apiUrl: 'http://localhost:3000',
  captureLevel: CaptureLevel.SAMPLED,
});

// Start a run
const runId = await xray.startRun('pipeline-1', inputData, {
  userId: 'user-123',
  requestId: 'req-456',
});

// Execute a step with automatic decision tracking
const result = await xray.step(
  runId,
  XRStepType.FILTER,
  'filter-low-scores',
  async (input: Array<{ id: string; score: number }>) => {
    // Business logic that returns items with decision metadata
    return input.map(item => ({
      itemId: item.id,
      outcome: item.score > 0.5 ? XRDecisionOutcome.KEPT : XRDecisionOutcome.ELIMINATED,
      input: item,
      output: item.score > 0.5 ? item : null,
      reason: item.score > 0.5 
        ? `Score ${item.score} exceeds threshold` 
        : `Score ${item.score} below threshold`,
      score: item.score,
    }));
  },
  inputData,
  { threshold: 0.5 }
);

// End the run
await xray.endRun(runId, result);

// Graceful shutdown (optional)
await xray.flush();
```

## API

### `startRun(pipelineId, input, metadata?)`

Starts a new pipeline run. Returns a `runId` that must be used for subsequent `step()` calls.

### `step(runId, stepType, stepName, businessLogic, input, config?)`

Executes a step and automatically captures:
- Input/output counts
- Decision events (based on capture level)
- Sampling (if enabled)

The `businessLogic` function must return an array of items with decision metadata:
- `itemId`: Unique identifier for the item
- `outcome`: `KEPT`, `ELIMINATED`, or `SCORED`
- `input`: Original input data
- `output`: Result after decision
- `reason`: Human-readable explanation
- `score`: Optional numeric score

### `endRun(runId, output?, error?)`

Ends a pipeline run. Marks it as completed or failed.

### `flush()`

Force flush all buffered events (useful for graceful shutdown).

## Capture Levels

- **`metrics_only`**: Only track input/output counts, no decision events
- **`sampled`**: Sample decision events using adaptive sampling
- **`full`**: Capture all decision events (no sampling)

## Design Principles

1. **Never block**: All operations are fire-and-forget
2. **Silent failures**: SDK errors never throw to application code
3. **Automatic capture**: No need to manually report decisions
4. **Efficient**: Batching and sampling reduce overhead

