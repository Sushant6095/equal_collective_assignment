/**
 * AWS S3 client for fetching raw payloads
 * 
 * Design: Fetch raw payloads from S3 only when needed.
 * ClickHouse stores S3 keys, we use those to fetch full payloads.
 */

import { S3Client as AWSS3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { XRDecisionEvent, XRRun, XRStep } from '@xray/shared-types';

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string; // Optional: for S3-compatible services
}

/**
 * AWS S3 client for fetching raw payloads
 * 
 * Lazy loading - only fetch from S3 when explicitly requested.
 * This keeps API responses fast by default, with option to fetch full payloads.
 */
export class S3Client {
  private client: AWSS3Client;
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
      clientConfig.forcePathStyle = true;
    }

    this.client = new AWSS3Client(clientConfig);
  }

  /**
   * Fetch decision event payload from S3
   * 
   * @param s3Key - S3 key (from ClickHouse decision_events table)
   * @returns Full decision event payload
   */
  async getDecisionEvent(s3Key: string): Promise<XRDecisionEvent | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        })
      );

      if (!response.Body) {
        return null;
      }

      // Convert stream to string
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const payload = JSON.parse(buffer.toString('utf-8'));
      return payload as XRDecisionEvent;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch run payload from S3
   */
  async getRun(s3Key: string): Promise<XRRun | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        })
      );

      if (!response.Body) {
        return null;
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const payload = JSON.parse(buffer.toString('utf-8'));
      return payload as XRRun;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch step payload from S3
   */
  async getStep(s3Key: string): Promise<XRStep | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        })
      );

      if (!response.Body) {
        return null;
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const payload = JSON.parse(buffer.toString('utf-8'));
      return payload as XRStep;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Generate S3 key from run ID and timestamp
   * (Matches format used in processor-worker)
   */
  getRunKey(runId: string, startedAt: Date): string {
    const year = startedAt.getFullYear();
    const month = String(startedAt.getMonth() + 1).padStart(2, '0');
    const day = String(startedAt.getDate()).padStart(2, '0');
    return `runs/${year}/${month}/${day}/${runId}.json`;
  }

  /**
   * Generate S3 key from step ID and timestamp
   */
  getStepKey(stepId: string, startedAt: Date): string {
    const year = startedAt.getFullYear();
    const month = String(startedAt.getMonth() + 1).padStart(2, '0');
    const day = String(startedAt.getDate()).padStart(2, '0');
    return `steps/${year}/${month}/${day}/${stepId}.json`;
  }
}

