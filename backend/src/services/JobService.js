/**
 * Global_Fit_Ulttra - Job Service
 *
 * Manages lifecycle and persistent state of async background jobs.
 *
 * @module services/JobService
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Job } from '../models/Job.js';
import { logger } from '../config/logger.js';

// In-memory fallback if Mongo is disconnected or for ultra-fast lookup
const memoryJobs = new Map();

export class JobService {
  constructor() {
    this.logger = logger || console;
  }

  _generateJobId(prefix = 'job') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${random}`;
  }

  async createJob(type, data = {}) {
    const jobId = this._generateJobId(type);
    const jobRecord = {
      jobId,
      type,
      status: 'queued',
      progress: 0,
      data,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    memoryJobs.set(jobId, { ...jobRecord });

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        await Job.create(jobRecord);
      } catch (err) {
        this.logger.warn('Failed to persist job to MongoDB, using in-memory store', { jobId, error: err.message });
      }
    }

    return jobRecord;
  }

  async updateJob(jobId, updates = {}) {
    const now = new Date();
    const mem = memoryJobs.get(jobId);
    if (mem) {
      Object.assign(mem, updates, { updatedAt: now });
      memoryJobs.set(jobId, mem);
    }

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        const doc = await Job.findOneAndUpdate(
          { jobId },
          { $set: { ...updates, updatedAt: now } },
          { new: true }
        );
        return doc ? doc.toObject() : mem;
      } catch (err) {
        this.logger.warn('Failed to update job in MongoDB', { jobId, error: err.message });
        return mem;
      }
    }

    return mem;
  }

  async getJob(jobId) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        const doc = await Job.findOne({ jobId }).lean();
        if (doc) return doc;
      } catch (err) {
        this.logger.warn('MongoDB job lookup failed, falling back to memory', { jobId, error: err.message });
      }
    }

    return memoryJobs.get(jobId) || null;
  }

  /**
   * Dispatches and tracks background document ingestion.
   */
  async runAsyncIngest(jobId, ingestionService, filePath, metadata = {}, semanticCache = null) {
    // Process asynchronously on next tick so the HTTP handler can immediately return 202
    setImmediate(async () => {
      try {
        await this.updateJob(jobId, { status: 'processing', progress: 10, startedAt: new Date() });

        await this.updateJob(jobId, { progress: 30 });
        const result = await ingestionService.ingestFile(filePath, metadata);

        // Invalidate semantic cache for this symbol upon new document ingestion
        if (semanticCache && typeof semanticCache.invalidate === 'function') {
          try {
            await semanticCache.invalidate(metadata.symbol || result.symbol);
          } catch (cacheErr) {
            this.logger.debug('Cache invalidation note on ingest', { error: cacheErr.message });
          }
        }

        await this.updateJob(jobId, {
          status: 'completed',
          progress: 100,
          result,
          completedAt: new Date(),
        });

        this.logger.info(`Background ingestion job completed: ${jobId}`, {
          symbol: result.symbol,
          chunks: result.chunkCount,
        });
      } catch (err) {
        this.logger.error(`Background ingestion job failed: ${jobId}`, { error: err.message });
        await this.updateJob(jobId, {
          status: 'failed',
          progress: 100,
          error: err.message,
          completedAt: new Date(),
        });
      }
    });
  }

  /**
   * Dispatches and tracks background reindexing.
   */
  async runAsyncReindex(jobId, ingestionService, semanticCache = null) {
    setImmediate(async () => {
      try {
        await this.updateJob(jobId, { status: 'processing', progress: 10, startedAt: new Date() });

        const results = await ingestionService.reindexAll();

        if (semanticCache && typeof semanticCache.invalidate === 'function') {
          try {
            await semanticCache.invalidate();
          } catch (cacheErr) {
            this.logger.debug('Cache invalidation note on reindex', { error: cacheErr.message });
          }
        }

        await this.updateJob(jobId, {
          status: 'completed',
          progress: 100,
          result: {
            reindexedCount: results.length,
            documents: results,
          },
          completedAt: new Date(),
        });

        this.logger.info(`Background reindex job completed: ${jobId}`, { count: results.length });
      } catch (err) {
        this.logger.error(`Background reindex job failed: ${jobId}`, { error: err.message });
        await this.updateJob(jobId, {
          status: 'failed',
          progress: 100,
          error: err.message,
          completedAt: new Date(),
        });
      }
    });
  }
}

export const jobService = new JobService();
export default jobService;
