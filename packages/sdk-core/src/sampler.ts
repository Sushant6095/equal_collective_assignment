/**
 * Adaptive sampling for decision events
 * 
 * Design trade-offs:
 * - We use deterministic sampling (hash-based) rather than random sampling
 *   to ensure the same items are sampled consistently across retries
 * - Sampling ratio is calculated to keep a target sample size (e.g., 5 from 5000)
 * - We always sample the first and last items to ensure boundary cases are captured
 */

/**
 * Capture levels determine how much data we collect
 * 
 * - metrics_only: Only count inputs/outputs, no decision events
 * - sampled: Sample decision events based on adaptive sampling
 * - full: Capture all decision events (no sampling)
 */
export enum CaptureLevel {
  METRICS_ONLY = 'metrics_only',
  SAMPLED = 'sampled',
  FULL = 'full',
}
/**
 * Adaptive sampler that reduces large batches to a manageable sample size
 * 
 * Trade-off: We use a simple modulo-based approach for performance.
 * For production, consider more sophisticated sampling (e.g., reservoir sampling
 * for truly random samples, or stratified sampling for representative samples).
 */
export class AdaptiveSampler {
  /**
   * Determines if an item should be sampled based on the total count
   * 
   * @param itemIndex - Zero-based index of the item
   * @param totalCount - Total number of items
   * @param targetSampleSize - Desired sample size (default: 5)
   * @returns true if item should be sampled
   * 
   * Design: Always includes first and last items, then samples uniformly
   * to reach target size. This ensures we capture boundary conditions.
   */
  shouldSample(
    itemIndex: number,
    totalCount: number,
    targetSampleSize: number = 5
  ): boolean {
    // Always sample first and last items
    if (itemIndex === 0 || itemIndex === totalCount - 1) {
      return true;
    }

    // If total is already small, sample everything
    if (totalCount <= targetSampleSize) {
      return true;
    }

    // Calculate sampling ratio
    // We subtract 2 because we always include first and last
    const remainingSlots = targetSampleSize - 2;
    const itemsToSample = totalCount - 2;
    const ratio = remainingSlots / itemsToSample;

    // Use deterministic sampling based on index
    // This ensures consistent sampling across retries
    const samplePoint = itemIndex / totalCount;
    return samplePoint < ratio * (remainingSlots / itemsToSample) * totalCount;
  }

  /**
   * Calculates the target sample size based on input count
   * 
   * Trade-off: Fixed target size (5) is simple but may not scale well.
   * Consider logarithmic scaling for very large batches (e.g., log10(count) * 10).
   */
  calculateTargetSampleSize(inputCount: number): number {
    // For very small batches, sample all
    if (inputCount <= 5) {
      return inputCount;
    }

    // For medium batches, sample a fixed amount
    if (inputCount <= 1000) {
      return 5;
    }

    // For large batches, use logarithmic scaling
    // This prevents excessive sampling while maintaining representativeness
    return Math.min(Math.ceil(Math.log10(inputCount) * 10), 100);
  }
}

