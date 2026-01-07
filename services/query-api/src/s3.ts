/**
 * S3/MinIO client for fetching raw payloads
 * 
 * Design: Fetch raw payloads from S3 only when needed.
 * ClickHouse stores S3 keys, we use those to fetch full payloads.
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
 * S3 client for fetching raw payloads
 * 
 * Trade-off: Lazy loading - only fetch from S3 when explicitly requested.
 * This keeps API responses fast by default, with option to fetch full payloads.
 */
export class S3Client {
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
   * Fetch decision event payload from S3
   * 
   * @param s3Key - S3 key (from ClickHouse decision_events table)
   * @returns Full decision event payload
   */
  async getDecisionEvent(s3Key: string): Promise<XRDecisionEvent | null> {
    try {
      const dataStream = await this.client.getObject(this.bucketName, s3Key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        dataStream.on('data', (chunk) => chunks.push(chunk));
        dataStream.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(payload as XRDecisionEvent);
          } catch (error) {
            reject(error);
          }
        });
        dataStream.on('error', reject);
      });
    } catch (error: any) {
      if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
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
      const dataStream = await this.client.getObject(this.bucketName, s3Key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        dataStream.on('data', (chunk) => chunks.push(chunk));
        dataStream.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(payload as XRRun);
          } catch (error) {
            reject(error);
          }
        });
        dataStream.on('error', reject);
      });
    } catch (error: any) {
      if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
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
      const dataStream = await this.client.getObject(this.bucketName, s3Key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        dataStream.on('data', (chunk) => chunks.push(chunk));
        dataStream.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(payload as XRStep);
          } catch (error) {
            reject(error);
          }
        });
        dataStream.on('error', reject);
      });
    } catch (error: any) {
      if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
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

