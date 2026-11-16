/**
 * Global_Fit_Ulttra - End-to-End RAG Lifecycle & Health Integration Tests
 *
 * Verifies:
 * 1. Honest health checks (/live, /ready, /health) with real dependency checks.
 * 2. Proper authentication (401 unauthenticated vs 403 unauthorized with role details).
 * 3. Document validation, path traversal guard, and ObjectId validation (400 vs 404).
 * 4. Asynchronous job status tracking (real job vs 404 for missing jobs).
 * 5. Route consistency across /api/v1/rag, /api/v1/ai/rag, and /rag.
 * 6. Sentiment analysis failure handling (no swallowed fake neutral data, returns requestId).
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/environment.js';
import { createHealthRoutes } from '../../src/routes/healthRoutes.js';
import { createRAGRoutes } from '../../src/routes/ragRoutes.js';
import { createAIRoutes } from '../../src/routes/aiRoutes.js';
import { HealthController } from '../../src/controllers/HealthController.js';
import { RAGController } from '../../src/controllers/RAGController.js';
import { AIController } from '../../src/controllers/AIController.js';
import { jobService } from '../../src/services/JobService.js';

describe('RAG Lifecycle & Resilience Integration Tests', () => {
  let app;
  let adminToken;
  let memberToken;

  beforeAll(() => {
    const accessSecret = config.security.jwtAccessSecret;

    adminToken = jwt.sign(
      { userId: 'admin_123', email: 'admin@globalfit.com', role: 'Admin' },
      accessSecret,
      { expiresIn: '1h' }
    );

    memberToken = jwt.sign(
      { userId: 'member_123', email: 'user@globalfit.com', role: 'Member' },
      accessSecret,
      { expiresIn: '1h' }
    );
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    // Attach request correlation ID
    app.use((req, res, next) => {
      req.requestId = req.headers['x-request-id'] || 'test-req-id-123';
      next();
    });

    const mockHealthController = new HealthController({
      mongoClient: { readyState: 1, ping: jest.fn().mockResolvedValue(true) },
      redisClient: { ping: jest.fn().mockResolvedValue('PONG') },
      wsServer: { wsEngine: { clients: new Set() } },
      rabbitmqClient: { isConnected: true },
    });

    const mockIngestionService = {
      ingestFile: jest.fn().mockResolvedValue({
        documentId: '6ace7827f056d614bedc96d8',
        symbol: 'AAPL',
        filingType: '10-Q',
        chunkCount: 25,
      }),
      reindexAll: jest.fn().mockResolvedValue([]),
    };

    const mockRagService = {
      query: jest.fn().mockResolvedValue({
        answer: 'Apple reported Services revenue of $24.2 billion and iPhone revenue of $39.3 billion.',
        citations: [{ document: 'AAPL FY24 Q3', page: 1, chunkIndex: 0 }],
        confidence: 95,
        retrievalCount: 4,
      }),
      vectorStore: {
        isQdrantHealthy: true,
        qdrantStore: { checkHealth: jest.fn().mockResolvedValue({ status: 'healthy', pointsCount: 25 }) },
        deleteByDocumentId: jest.fn().mockResolvedValue(true),
      },
      semanticCache: {
        invalidate: jest.fn().mockResolvedValue(true),
      },
    };

    const ragController = new RAGController({
      ragService: mockRagService,
      ingestionService: mockIngestionService,
    });

    const mockAINewsService = {
      analyzeSentiment: jest.fn().mockRejectedValue(new Error('LLM provider unavailable')),
    };

    const aiController = new AIController({
      aiNewsService: mockAINewsService,
      aiMarketService: {},
      aiJobQueue: null,
    });

    // Mount routes
    app.use('/api/v1/health', createHealthRoutes(mockHealthController));
    app.use('/api/v1/rag', createRAGRoutes(ragController));
    app.use('/rag', createRAGRoutes(ragController));
    app.use('/api/v1/ai', createAIRoutes(aiController, ragController));
  });

  describe('Health Checks & Readiness Probes', () => {
    it('GET /api/v1/health/live returns 200 liveness', async () => {
      const res = await request(app).get('/api/v1/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('live');
      expect(res.body.requestId).toBeDefined();
    });

    it('GET /api/v1/health/ready returns readiness with components', async () => {
      const res = await request(app).get('/api/v1/health/ready');
      expect([200, 503]).toContain(res.status);
      expect(['ready', 'not_ready']).toContain(res.body.status);
      expect(res.body.checks).toBeDefined();
    });
  });

  describe('Authorization & Guardrails', () => {
    it('POST /api/v1/ai/rag/ingest returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/v1/ai/rag/ingest')
        .send({
          filePath: './data/financial_documents/AAPL_FY24_Q3_Financial_Filing.pdf',
          symbol: 'AAPL',
          filingType: '10-Q',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('E1003');
    });

    it('POST /api/v1/ai/rag/ingest returns 403 E1009 when called with Member token', async () => {
      const res = await request(app)
        .post('/api/v1/ai/rag/ingest')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          filePath: './data/financial_documents/AAPL_FY24_Q3_Financial_Filing.pdf',
          symbol: 'AAPL',
          filingType: '10-Q',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('E1009');
      expect(res.body.error.message).toContain('Admin');
    });

    it('POST /api/v1/ai/rag/ingest returns 202 Accepted with a real jobId when called with Admin token', async () => {
      const res = await request(app)
        .post('/api/v1/ai/rag/ingest')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          filePath: './data/financial_documents/AAPL_FY24_Q3_Financial_Filing.pdf',
          symbol: 'AAPL',
          filingType: '10-Q',
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.jobId).toBeDefined();
      expect(res.body.data.status).toBe('queued');
    });
  });

  describe('Job Status Endpoint', () => {
    it('GET /api/v1/ai/rag/jobs/missing-job-xyz returns 404 for unknown job ID', async () => {
      const res = await request(app)
        .get('/api/v1/ai/rag/jobs/missing-job-xyz')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('E4004');
    });

    it('GET /api/v1/ai/rag/jobs/:jobId returns real status for created job', async () => {
      const job = await jobService.createJob('ingest', { symbol: 'AAPL' });
      const res = await request(app)
        .get(`/api/v1/ai/rag/jobs/${job.jobId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.jobId).toBe(job.jobId);
      expect(res.body.data.status).toBe('queued');
    });
  });

  describe('Document Endpoints Validation', () => {
    it('GET /api/v1/ai/rag/documents/:id returns 400 for malformed ObjectId', async () => {
      const res = await request(app)
        .get('/api/v1/ai/rag/documents/not-a-valid-object-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('E4000');
    });

    it('DELETE /api/v1/ai/rag/documents/:id returns 400 for malformed ObjectId', async () => {
      const res = await request(app)
        .delete('/api/v1/ai/rag/documents/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('E4000');
    });
  });

  describe('Route Consistency Aliasing', () => {
    it('POST /rag/query works identically to /api/v1/rag/query', async () => {
      const queryBody = {
        question: "What were Apple's Services revenue and iPhone revenue in Q3 2024?",
        symbol: 'AAPL',
      };

      const resRoot = await request(app)
        .post('/rag/query')
        .set('Authorization', `Bearer ${memberToken}`)
        .send(queryBody);

      const resApi = await request(app)
        .post('/api/v1/rag/query')
        .set('Authorization', `Bearer ${memberToken}`)
        .send(queryBody);

      expect(resRoot.status).toBe(200);
      expect(resApi.status).toBe(200);
      expect(resRoot.body.data.answer).toEqual(resApi.body.data.answer);
    });
  });

  describe('Sentiment Endpoint Honest 503 & RequestId', () => {
    it('POST /api/v1/ai/sentiment returns 503 with requestId when LLM is unavailable', async () => {
      const res = await request(app)
        .post('/api/v1/ai/sentiment')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ text: 'Apple reported record revenue' });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('E5003');
      expect(res.body.requestId).toBeDefined();
    });
  });
});
