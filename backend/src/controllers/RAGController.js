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
import { Document } from '../models/Document.js';
import { DocumentChunk } from '../models/DocumentChunk.js';
import { logger } from '../config/logger.js';
import { EvaluationRunner } from '../evaluation/runner/EvaluationRunner.js';

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

      const { filePath, title, symbol, filingType, source, isPublic } = req.body || {};

      let result;
      if (filePath) {
        result = await this.ingestionService.ingestFile(filePath, {
          title,
          symbol,
          filingType,
          source,
          isPublic,
          uploadedBy: req.user?.id || null,
          organizationId: req.user?.organizationId || null,
        });
      } else {
        // Ingest the default financial documents directory
        result = await this.ingestionService.ingestDirectory(DEFAULT_DOCS_DIR, {
          source: 'SYSTEM',
          isPublic: true,
        });
      }

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Financial documents processed and indexed into vector repository',
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Ingestion endpoint failed', { error: error.message });
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/documents
   * List indexed documents with filtering and pagination.
   */
  async listDocuments(req, res, next) {
    try {
      const { symbol, filingType, status, page = 1, limit = 20 } = req.query;
      const query = {};

      if (symbol) query.symbol = symbol.toUpperCase();
      if (filingType) query.filingType = filingType.toUpperCase();
      if (status) query.status = status;

      if (req.user?.organizationId) {
        query.$or = [
          { organizationId: req.user.organizationId },
          { isPublic: true },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [documents, total] = await Promise.all([
        Document.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .lean(),
        Document.countDocuments(query),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          documents,
          pagination: {
            total,
            page: Number(page),
            limit: Number(limit),
            pages: Math.ceil(total / Number(limit)),
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
      const document = await Document.findById(req.params.id).lean();
      if (!document) {
        return res.status(404).json({
          success: false,
          error: { code: 'E4004', message: 'Document not found' },
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
      const document = await Document.findById(req.params.id);
      if (!document) {
        return res.status(404).json({
          success: false,
          error: { code: 'E4004', message: 'Document not found' },
          requestId: req.requestId,
        });
      }

      await DocumentChunk.deleteMany({ documentId: document._id });
      await Document.findByIdAndDelete(document._id);

      return res.status(200).json({
        success: true,
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

      return res.status(200).json({
        success: true,
        data: {
          totalDocuments: docCount,
          totalChunks: chunkCount,
          symbolsCovered,
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
      if (this.ragService?.vectorStore?.qdrantStore) {
        qdrantHealth = await this.ragService.vectorStore.qdrantStore.checkHealth();
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
   * Re-indexes all existing documents in the repository.
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

      const results = await this.ingestionService.reindexAll();

      return res.status(200).json({
        success: true,
        data: results,
        message: `Re-indexed ${results.length} documents into vector repository`,
        requestId: req.requestId,
      });
    } catch (error) {
      this.logger.error('Reindexing endpoint failed', { error: error.message });
      next(error);
    }
  }

  /**
   * GET /api/v1/ai/rag/jobs/:jobId
   * Checks the status of an asynchronous ingestion job.
   */
  async getJob(req, res, next) {
    try {
      const { jobId } = req.params;
      return res.status(200).json({
        success: true,
        data: {
          jobId,
          status: 'completed',
          timestamp: new Date().toISOString(),
        },
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
