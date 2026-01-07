/**
 * S3/MinIO client for storing full raw payloads
 * 
 * Design: Stores complete decision event payloads with deterministic keys
 * for idempotent processing. Keys are based on event ID to ensure
 * same event always maps to same S3 key.
 */

import * as MinIO from 'minio';
import { XRDecisionEvent, XRRun, XRStep } from '@xray/shared-types';

export interface S3Config {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

/**
 * S3/MinIO storage for raw payloads
 * 
 * Trade-off: Deterministic keys based on event ID ensure idempotency.
 * Same event ID always maps to same S3 key, so retries are safe.
 * 
 * Key format: {type}/{year}/{month}/{day}/{id}.json
 * Example: decisions/2024/01/15/event-123.json
 */
export class S3Storage {
  private client: MinIO.Client;
  private bucketName: string;

  constructor(config: S3Config) {
    this.bucketName = config.bucket;
    this.client = new MinIO.Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  /**
   * Initialize bucket if it doesn't exist
   * 
   * Idempotent: Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucketName);
    if (!exists) {
      await this.client.makeBucket(this.bucketName, 'us-east-1');
    }
  }

  /**
   * Generate deterministic S3 key for a decision event
   * 
   * Format: decisions/{year}/{month}/{day}/{eventId}.json
   * 
   * Trade-off: Date-based partitioning enables efficient queries by date range.
   * Event ID ensures uniqueness and idempotency.
   */
  private getDecisionEventKey(event: XRDecisionEvent): string {
    const date = event.timestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `decisions/${year}/${month}/${day}/${event.id}.json`;
  }

  /**
   * Generate deterministic S3 key for a run
   */
  private getRunKey(run: XRRun): string {
    const date = run.startedAt;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `runs/${year}/${month}/${day}/${run.id}.json`;
  }

  /**
   * Generate deterministic S3 key for a step
   */
  private getStepKey(step: XRStep, runId: string): string {
    const date = step.startedAt;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `steps/${year}/${month}/${day}/${step.id}.json`;
  }

  /**
   * Store decision event payload
   * 
   * Idempotent: If object already exists, this is a no-op (or overwrites with same data).
   * Deterministic key ensures same event always goes to same location.
   */
  async storeDecisionEvent(event: XRDecisionEvent): Promise<string> {
    const key = this.getDecisionEventKey(event);
    const payload = JSON.stringify(event);
    const buffer = Buffer.from(payload, 'utf-8');

    // Check if object exists (idempotency check)
    // Trade-off: We could skip the check and just overwrite, but checking
    // allows us to log when we're processing duplicates.
    try {
      await this.client.statObject(this.bucketName, key);
      // Object exists - this is a retry, which is fine
    } catch (error: any) {
      // Object doesn't exist or error - proceed with upload
      if (error.code !== 'NotFound') {
        throw error;
      }
    }

    await this.client.putObject(
      this.bucketName,
      key,
      buffer,
      buffer.length,
      {
        'Content-Type': 'application/json',
        'X-Event-Id': event.id,
        'X-Run-Id': event.runId,
        'X-Step-Id': event.stepId,
      }
    );

    return key;
  }

  /**
   * Store run payload
   */
  async storeRun(run: XRRun): Promise<string> {
    const key = this.getRunKey(run);
    const payload = JSON.stringify(run);
    const buffer = Buffer.from(payload, 'utf-8');

    try {
      await this.client.statObject(this.bucketName, key);
    } catch (error: any) {
      if (error.code !== 'NotFound') {
        throw error;
      }
    }

    await this.client.putObject(
      this.bucketName,
      key,
      buffer,
      buffer.length,
      {
        'Content-Type': 'application/json',
        'X-Run-Id': run.id,
        'X-Pipeline-Id': run.pipelineId,
      }
    );

    return key;
  }

  /**
   * Store step payload
   */
  async storeStep(step: XRStep, runId: string): Promise<string> {
    const key = this.getStepKey(step, runId);
    const payload = JSON.stringify({ ...step, runId });
    const buffer = Buffer.from(payload, 'utf-8');

    try {
      await this.client.statObject(this.bucketName, key);
    } catch (error: any) {
      if (error.code !== 'NotFound') {
        throw error;
      }
    }

    await this.client.putObject(
      this.bucketName,
      key,
      buffer,
      buffer.length,
      {
        'Content-Type': 'application/json',
        'X-Step-Id': step.id,
        'X-Run-Id': runId,
      }
    );

    return key;
  }

  /**
   * Check if a decision event already exists (idempotency check)
   */
  async decisionEventExists(eventId: string, timestamp: Date): Promise<boolean> {
    const date = timestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const key = `decisions/${year}/${month}/${day}/${eventId}.json`;

    try {
      await this.client.statObject(this.bucketName, key);
      return true;
    } catch (error: any) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}

