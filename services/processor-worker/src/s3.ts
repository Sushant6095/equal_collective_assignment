/**
 * AWS S3 client for storing raw payloads
 * 
 * Uses deterministic keys based on event ID so retries are safe.
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { XRDecisionEvent, XRRun, XRStep } from '@xray/shared-types';

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string; // Optional: for S3-compatible services
}

/**
 * AWS S3 storage for raw payloads. Key format: {type}/{year}/{month}/{day}/{id}.json
 */
export class S3Storage {
  private client: S3Client;
  private bucketName: string;

  constructor(config: S3Config) {
    this.bucketName = config.bucket;
    
    // Create S3 client
    const clientConfig: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    // Add endpoint if provided (for S3-compatible services)
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true; // Required for S3-compatible services
    }

    this.client = new S3Client(clientConfig);
  }

  /**
   * Create bucket if it doesn't exist. Safe to call multiple times.
   */
  async initialize(): Promise<void> {
    try {
      // Check if bucket exists
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
    } catch (error: any) {
      // Bucket doesn't exist, create it
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucketName,
          })
        );
      } else {
        throw error;
      }
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
    // Handle both Date objects and ISO strings (from JSON deserialization)
    const date = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `decisions/${year}/${month}/${day}/${event.id}.json`;
  }

  /**
   * Generate deterministic S3 key for a run
   */
  private getRunKey(run: XRRun): string {
    // Handle both Date objects and ISO strings (from JSON deserialization)
    const date = run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `runs/${year}/${month}/${day}/${run.id}.json`;
  }

  /**
   * Generate deterministic S3 key for a step
   */
  private getStepKey(step: XRStep, runId: string): string {
    // Handle both Date objects and ISO strings (from JSON deserialization)
    const date = step.startedAt instanceof Date ? step.startedAt : new Date(step.startedAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `steps/${year}/${month}/${day}/${step.id}.json`;
  }

  /**
   * Store decision event payload
   * 
   * Idempotent: If object already exists, overwrites with same data.
   * Deterministic key ensures same event always goes to same location.
   */
  async storeDecisionEvent(event: XRDecisionEvent): Promise<string> {
    const key = this.getDecisionEventKey(event);
    const payload = JSON.stringify(event);
    const buffer = Buffer.from(payload, 'utf-8');

    // Check if object exists (idempotency check)
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      // Object exists - this is a retry, which is fine
    } catch (error: any) {
      // Object doesn't exist or error - proceed with upload
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/json',
        Metadata: {
          'event-id': event.id,
          'run-id': event.runId,
          'step-id': event.stepId,
        },
      })
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
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (error: any) {
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/json',
        Metadata: {
          'run-id': run.id,
          'pipeline-id': run.pipelineId,
        },
      })
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
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (error: any) {
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'application/json',
        Metadata: {
          'step-id': step.id,
          'run-id': runId,
        },
      })
    );

    return key;
  }

  /**
   * Check if a decision event already exists (idempotency check)
   */
  async decisionEventExists(eventId: string, timestamp: Date | string): Promise<boolean> {
    // Handle both Date objects and ISO strings
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const key = `decisions/${year}/${month}/${day}/${eventId}.json`;

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

