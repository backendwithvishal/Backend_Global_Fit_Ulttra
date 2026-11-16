/**
 * Global_Fit_Ulttra - RAG Controller
 * 
 * Express controller handling RAG queries, document ingestion,
 * and vector knowledge base management.
 * 
 * @module controllers/RAGController
 */

import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { logger } from '../config/logger.js';
import { EvaluationRunner } from '../evaluation/runner/EvaluationRunner.js';
import { jobService } from '../services/JobService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOCS_DIR = path.resolve(__dirname, '..', '..', 'data', 'financial_documents');

export class RAGController {
  constructor({ ragService, ingestionService } = {}) {
    this.ragService = ragService;
    this.ingestionService = ingestionService;
    this.logger = logger || console;

    // Bind methods to maintain `this` context
    this.query = this.query.bind(this);
    this.ingest = this.ingest.bind(this);
    this.listDocuments = this.listDocuments.bind(this);
    this.getDocument = this.getDocument.bind(this);
    this.deleteDocument = this.deleteDocument.bind(this);
    this.getStats = this.getStats.bind(this);
    this.getHealth = this.getHealth.bind(this);
    this.reindex = this.reindex.bind(this);
    this.getJob = this.getJob.bind(this);
    this.evaluate = this.evaluate.bind(this);
  }

  /**
   * POST /api/v1/ai/rag/query
   * Grounded financial question answering with source citations.
   */
  async query(req, res, next) {
    try {
      if (!this.ragService) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'E5003',
            message: 'RAG service is currently unavailable. Vector index may still be initializing.',
          },
          requestId: req.requestId,
        });
      }

      const { question, symbol, filingType, topK, bypassCache } = req.body;
      const organizationId = req.user?.organizationId || null;

      const result = await this.ragService.query({
        question,
        symbol,
        filingType,
        topK,
        organizationId,
        bypassCache,
      });

      return res.status(200).json({
        success: true,
        data: result,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('RAG query endpoint failed', { error: error.message });
      next(error);
    }
  }

  /**
   * POST /api/v1/ai/rag/ingest
   * Trigger document ingestion from disk or default sample financial documents.
   * Runs as an asynchronous background job and immediately returns 202 Accepted.
   */
  async ingest(req, res, next) {
    try {
      if (!this.ingestionService) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'E5003',
            message: 'Ingestion service is currently unavailable.',
          },
          requestId: req.requestId,
        });
      }

      const { filePath, title, symbol, filingType, fiscalYear, fiscalQuarter, period, source, isPublic } = req.body || {};
      const uploadedBy = req.user?.userId || req.user?.id || null;
      const organizationId = req.user?.organizationId || null;

      let targetPath = null;
      let isDirectory = false;

      if (req.file) {
        targetPath = req.file.path;
      } else if (filePath) {
        targetPath = filePath;
      } else {
        targetPath = DEFAULT_DOCS_DIR;
        isDirectory = true;
      }

      const jobMetadata = {
        title: title || (req.file ? req.file.originalname : undefined),
        symbol,
        filingType,
        fiscalYear,
        fiscalQuarter,
        period,
        source: req.file ? 'MANUAL_UPLOAD' : (source || (filePath ? 'FILE_SYSTEM' : 'SYSTEM')),
        isPublic: isPublic !== undefined ? isPublic : true,
        uploadedBy,
        organizationId,
        isDirectory,
      };

      const job = await jobService.createJob('ingest', {
        filePath: targetPath,
        ...jobMetadata,
      });

      // Execute background processing
      if (isDirectory) {
        setImmediate(async () => {
          try {
            await jobService.updateJob(job.jobId, { status: 'processing', progress: 10, startedAt: new Date() });
            const result = await this.ingestionService.ingestDirectory(targetPath, jobMetadata);
            if (this.ragService?.semanticCache?.invalidate) {
              await this.ragService.semanticCache.invalidate();
            }
            await jobService.updateJob(job.jobId, {
              status: 'completed',
              progress: 100,
              result,
              completedAt: new Date(),
            });
          } catch (err) {
            this.logger.error(`Directory ingestion job failed: ${job.jobId}`, { error: err.message });
            await jobService.updateJob(job.jobId, {
              status: 'failed',
              progress: 100,
              error: err.message,
              completedAt: new Date(),
            });
          }
        });
      } else {
        jobService.runAsyncIngest(
          job.jobId,
          this.ingestionService,
          targetPath,
          jobMetadata,
          this.ragService?.semanticCache
        );
      }

      return res.status(202).json({
        success: true,
        data: {
          jobId: job.jobId,
          status: 'queued',
          message: 'Document ingestion accepted for processing',
        },
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Ingestion endpoint dispatch failed', { error: error.message });
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/documents
   * List indexed documents with filtering and pagination.
   */
  async listDocuments(req, res, next) {
    try {
      const { symbol, filingType, fiscalYear, fiscalQuarter, period, status, page = 1, limit = 20 } = req.query;
      const query = {};

      if (symbol) query.symbol = symbol.toUpperCase();
      if (filingType) query.filingType = filingType.toUpperCase();
      if (fiscalYear) query.fiscalYear = Number(fiscalYear);
      if (fiscalQuarter) query.fiscalQuarter = fiscalQuarter.toUpperCase();
      if (period) query.period = period;
      if (status) query.status = status;

      if (req.user?.role !== 'Admin') {
        if (req.user?.organizationId) {
          query.$or = [
            { organizationId: req.user.organizationId },
            { isPublic: true },
          ];
        } else {
          query.isPublic = true;
        }
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [documents, total] = await Promise.all([
        Document.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Document.countDocuments(query),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          documents,
          pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            pages: Math.ceil(total / limitNum) || 1,
          },
        },
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/documents/:id
   * Retrieve document details and chunk preview.
   */
  async getDocument(req, res, next) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          error: { code: 'E4000', message: `Invalid document ID format: ${id}` },
          requestId: req.requestId,
        });
      }

      const document = await Document.findById(id).lean();
      if (!document) {
        return res.status(404).json({
          success: false,
          error: { code: 'E4004', message: 'Document not found' },
          requestId: req.requestId,
        });
      }

      const isAllowed =
        req.user?.role === 'Admin' ||
        document.isPublic === true ||
        (req.user?.organizationId && document.organizationId && document.organizationId.toString() === req.user.organizationId.toString());

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: { code: 'E1019', message: 'Forbidden: You do not have access to this document' },
          requestId: req.requestId,
        });
      }

      const chunks = await DocumentChunk.find({ documentId: document._id })
        .select('chunkIndex content tokenCount metadata')
        .sort({ chunkIndex: 1 })
        .limit(20)
        .lean();

      return res.status(200).json({
        success: true,
        data: {
          document,
          chunks,
          totalChunks: document.chunkCount,
        },
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/ai/rag/documents/:id
   * Delete an indexed document and all its chunks.
   */
  async deleteDocument(req, res, next) {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({
          success: false,
          error: { code: 'E4000', message: `Invalid document ID format: ${id}` },
          requestId: req.requestId,
        });
      }

      const document = await Document.findById(id);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: { code: 'E4004', message: 'Document not found' },
          requestId: req.requestId,
        });
      }

      const isAllowed =
        req.user?.role === 'Admin' ||
        (req.user?.organizationId && document.organizationId && document.organizationId.toString() === req.user.organizationId.toString());

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          error: { code: 'E1019', message: 'Forbidden: You do not have permission to delete this document' },
          requestId: req.requestId,
        });
      }

      const chunkResult = await DocumentChunk.deleteMany({ documentId: document._id });

      // Remove points from vector store (Qdrant & Mongo vector fallback)
      if (this.ragService?.vectorStore?.deleteByDocumentId) {
        try {
          await this.ragService.vectorStore.deleteByDocumentId(document._id.toString());
        } catch (vecErr) {
          this.logger.warn('Failed to delete vector points during document deletion', { error: vecErr.message });
        }
      }

      // Invalidate semantic cache for this document symbol
      if (this.ragService?.semanticCache?.invalidate) {
        try {
          await this.ragService.semanticCache.invalidate(document.symbol);
        } catch (cacheErr) {
          this.logger.warn('Failed to invalidate cache during document deletion', { error: cacheErr.message });
        }
      }

      await Document.findByIdAndDelete(document._id);

      return res.status(200).json({
        success: true,
        data: {
          deletedDocumentId: document._id,
          symbol: document.symbol,
          filingType: document.filingType,
          title: document.title,
          chunksRemoved: chunkResult.deletedCount,
        },
        message: 'Document and associated vector chunks removed',
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/stats
   * Statistics on vector index coverage and indexed documents.
   */
  async getStats(req, res, next) {
    try {
      const [docCount, chunkCount, symbolsCovered] = await Promise.all([
        Document.countDocuments({ status: 'indexed' }),
        DocumentChunk.countDocuments(),
        Document.distinct('symbol', { status: 'indexed' }),
      ]);

      const isQdrantHealthy = this.ragService?.vectorStore?.isQdrantHealthy;
      const activeStore = (this.ragService?.vectorStore?.qdrantStore && isQdrantHealthy !== false)
        ? 'qdrant'
        : 'mongodb_fallback';

      return res.status(200).json({
        success: true,
        data: {
          totalDocuments: docCount,
          totalChunks: chunkCount,
          symbolsCovered,
          activeStore,
          embeddingProvider: this.ingestionService?.embeddingClient?.provider || 'local',
          vectorDimensions: this.ingestionService?.embeddingClient?.dimensions || 384,
          semanticCacheEnabled: !!this.ragService?.semanticCache,
        },
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/health
   * Detailed health check of RAG subsystems (vector store, embeddings, cache).
   */
  async getHealth(req, res, next) {
    try {
      let qdrantHealth = { status: 'disabled' };
      let activeStore = 'mongodb_fallback';
      if (this.ragService?.vectorStore?.qdrantStore) {
        try {
          qdrantHealth = await this.ragService.vectorStore.qdrantStore.checkHealth();
          if (qdrantHealth.status === 'healthy') {
            activeStore = 'qdrant';
          }
        } catch (qErr) {
          qdrantHealth = { status: 'unhealthy', error: qErr.message };
        }
      }

      const checks = {
        ragService: !!this.ragService,
        ingestionService: !!this.ingestionService,
        embeddingEngine: {
          provider: this.ragService?.embeddingClient?.provider || 'local',
          dimensions: this.ragService?.embeddingClient?.dimensions || 384,
          model: this.ragService?.embeddingClient?.model || 'Xenova/all-MiniLM-L6-v2',
          status: 'ready',
        },
        vectorStore: {
          activeStore,
          qdrant: qdrantHealth,
          mongoFallback: 'active',
        },
        semanticCache: {
          enabled: !!this.ragService?.semanticCache,
        },
      };

      return res.status(200).json({
        success: true,
        status: 'healthy',
        checks,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/ai/rag/reindex
   * Re-indexes all existing documents in the repository asynchronously.
   */
  async reindex(req, res, next) {
    try {
      if (!this.ingestionService) {
        return res.status(503).json({
          success: false,
          error: { code: 'E5003', message: 'Ingestion service is unavailable' },
          requestId: req.requestId,
        });
      }

      const job = await jobService.createJob('reindex', {});
      jobService.runAsyncReindex(job.jobId, this.ingestionService, this.ragService?.semanticCache);

      return res.status(202).json({
        success: true,
        data: {
          jobId: job.jobId,
          status: 'queued',
          message: 'Document reindexing accepted for background execution',
        },
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Reindexing endpoint dispatch failed', { error: error.message });
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/jobs/:jobId
   * Checks the real status of an asynchronous ingestion or reindexing job.
   */
  async getJob(req, res, next) {
    try {
      const { jobId } = req.params;
      const job = await jobService.getJob(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'E4004',
            message: `Job '${jobId}' not found`,
          },
          requestId: req.requestId,
        });
      }

      return res.status(200).json({
        success: true,
        data: job,
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/ai/rag/evaluate
   * Triggers automated RAG evaluation benchmark with bounds.
   */
  async evaluate(req, res, next) {
    try {
      if (!this.ragService) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'E5003',
            message: 'RAG service is currently unavailable.',
          },
          requestId: req.requestId,
        });
      }

      const { topK = 4 } = req.body || {};
      const boundedTopK = Math.min(10, Math.max(1, parseInt(topK, 10) || 4));

      const runner = new EvaluationRunner({
        ragService: this.ragService,
        topK: boundedTopK,
      });

      const report = await runner.run();

      return res.status(200).json({
        success: true,
        data: {
          runId: report.runId,
          timestamp: report.timestamp,
          summary: report.summary,
          thresholdResults: report.thresholdResults,
          aggregateMetrics: report.aggregateMetrics,
        },
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Evaluation endpoint failed', { error: error.message });
      next(error);
    }
  }
}

export default RAGController;
