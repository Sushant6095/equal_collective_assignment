/**
 * Shared data model for X-Ray Decision Observability System
 * 
 * This module defines the core data structures used across all services
 * for tracking pipeline runs, steps, and decision events.
 */

/**
 * XRStepType - Enumeration of step types in a pipeline
 * 
 * Why this exists: Different step types have different behaviors and metadata requirements.
 * Using an enum ensures type safety and makes it easy to add step-specific handling logic.
 * 
 * - filter: Steps that remove items from a collection based on criteria
 * - rank: Steps that order or score items relative to each other
 * - llm: Steps that use language models to make decisions or transformations
 * - transform: Steps that modify data structure or content without filtering
 */
export enum XRStepType {
  FILTER = 'filter',
  RANK = 'rank',
  LLM = 'llm',
  TRANSFORM = 'transform',
  SCORE = 'score',
}

/**
 * XRDecisionOutcome - Possible outcomes of a decision event
 * 
 * Why this exists: Decisions in pipelines have distinct outcomes that affect downstream processing.
 * This enum ensures we can query and analyze decisions by their outcome type, which is critical
 * for observability and debugging.
 * 
 * - kept: Item passed through the step and continues in the pipeline
 * - eliminated: Item was removed/filtered out and won't continue
 * - scored: Item received a score/ranking but outcome depends on threshold or context
 */
export enum XRDecisionOutcome {
  KEPT = 'kept',
  ELIMINATED = 'eliminated',
  SCORED = 'scored',
}

/**
 * XRStep - Represents a single step in a pipeline run
 * 
 * Why this exists: Steps are the atomic units of pipeline execution. Each step can make
 * multiple decisions, and we need to track which step produced which decisions for
 * debugging and traceability. Steps also carry configuration that affects their behavior.
 * 
 * Properties:
 * - id: Unique identifier for this step instance (allows multiple steps of same type)
 * - type: The kind of step (filter, rank, llm, transform)
 * - name: Human-readable name for display and debugging
 * - config: Step-specific configuration (extensible for different step types)
 * - startedAt: When step execution began
 * - completedAt: When step execution finished (null if still running or failed)
 */
export interface XRStep {
  id: string;
  type: XRStepType;
  name: string;
  config?: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * XRDecisionEvent - Records a single decision made during pipeline execution
 * 
 * Why this exists: This is the core observability primitive. Every decision point in a
 * pipeline should emit a decision event so we can trace why items were kept, eliminated,
 * or scored. This enables debugging ("why was this item filtered?") and analytics
 * ("how many items were eliminated at step X?").
 * 
 * Properties:
 * - id: Unique identifier for this decision event
 * - stepId: Which step made this decision (links to XRStep)
 * - runId: Which run this decision belongs to (links to XRRun)
 * - outcome: The result of the decision (kept, eliminated, scored)
 * - itemId: Identifier for the item being decided upon (allows tracking same item across steps)
 * - input: The data that was input to the decision logic
 * - output: The result/output of the decision
 * - reason: Human-readable explanation of why this decision was made
 * - score: Optional numeric score (used when outcome is 'scored')
 * - metadata: Extensible field for step-specific or decision-specific data
 * - timestamp: When the decision was made (critical for ordering and time-based queries)
 */
export interface XRDecisionEvent {
  id: string;
  stepId: string;
  runId: string;
  outcome: XRDecisionOutcome;
  itemId: string;
  input: unknown;
  output: unknown;
  reason: string;
  score?: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * XRRun - Represents a complete execution of a pipeline
 * 
 * Why this exists: A run is the top-level container that groups all steps and decisions
 * for a single pipeline execution. This allows us to:
 * - Query all decisions for a specific run
 * - Track run-level metrics (duration, success/failure)
 * - Correlate decisions across steps within the same run
 * - Support multiple concurrent runs
 * 
 * Properties:
 * - id: Unique identifier for this run
 * - pipelineId: Which pipeline definition was executed
 * - status: Current state of the run (allows tracking in-progress runs)
 * - input: Initial input data to the pipeline
 * - output: Final output after all steps (null if run failed or incomplete)
 * - startedAt: When the run began
 * - completedAt: When the run finished (null if still running or failed)
 * - error: Error message if run failed
 * - metadata: Extensible field for run-level metadata (e.g., user ID, request ID, etc.)
 */
export interface XRRun {
  id: string;
  pipelineId: string;
  status: XRRunStatus;
  input: unknown;
  output: unknown | null;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * XRRunStatus - Possible states of a pipeline run
 * 
 * Why this exists: Runs can be in various states (running, completed, failed, etc.).
 * This enum allows services to query runs by status and implement proper state management.
 */
export enum XRRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
