/**
 * Global_Fit_Ulttra - RAG Unit Tests
 * 
 * Tests for financial chunker, embedding vectorizer, semantic cache,
 * BM25 lexical retriever, Qdrant store, Agentic Orchestrator, LiteLLM Gateway,
 * LangSmith tracer, and RAG routes.
 * 
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { chunkFinancialText, detectSection, isTableBlock } from '../../src/utils/financialChunker.js';
import { EmbeddingClient } from '../../src/infrastructure/ai/EmbeddingClient.js';
import { SemanticCache } from '../../src/infrastructure/cache/SemanticCache.js';
import { RerankerClient } from '../../src/infrastructure/ai/RerankerClient.js';
import { BM25Retriever } from '../../src/infrastructure/vector/BM25Retriever.js';
import { QdrantVectorStore } from '../../src/infrastructure/vector/QdrantVectorStore.js';
import { AgenticRAGOrchestrator } from '../../src/infrastructure/ai/AgenticRAGOrchestrator.js';
import axios from 'axios';
import { LiteLLMGateway } from '../../src/infrastructure/ai/LiteLLMGateway.js';
import { LangSmithTracer } from '../../src/infrastructure/ai/LangSmithTracer.js';
import { RAGService } from '../../src/services/RAGService.js';
import { IngestionService } from '../../src/services/IngestionService.js';
import { Document } from '../../src/models/Document.js';
import { VectorStore } from '../../src/infrastructure/vector/VectorStore.js';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/environment.js';
import { createRAGRoutes } from '../../src/routes/ragRoutes.js';

describe('RAG System Unit Tests', () => {
  describe('financialChunker', () => {
    it('should detect standard SEC section headers', () => {
      expect(detectSection('ITEM 1A. RISK FACTORS - Operational Risks')).toBe('Item 1A: Risk Factors');
      expect(detectSection('ITEM 7. MANAGEMENT DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION')).toBe('Item 7: MD&A');
      expect(detectSection('CONSOLIDATED BALANCE SHEETS (in millions)')).toBe('Consolidated Balance Sheets');
      expect(detectSection('Regular text with no headings')).toBeNull();
    });

    it('should recognize financial tables', () => {
      const tableText = `
Revenue by Product:
======================================================
iPhone                         $39,296       $39,669
Mac                             $7,009        $6,840
iPad                            $7,162        $5,791
======================================================
`;
      expect(isTableBlock(tableText)).toBe(true);
      expect(isTableBlock('Just a normal narrative paragraph with no numbers.')).toBe(false);
    });

    it('should split financial documents into structured chunks with metadata', () => {
      const sampleDoc = `
ITEM 1. FINANCIAL STATEMENTS

Net sales were $85.78 billion, an increase of 5% compared to prior year.
Gross margin reached $39.68 billion (46.3%).

ITEM 1A. RISK FACTORS

The Company faces intense competition globally in artificial intelligence.
Supply chain dependencies remain exposed to geopolitical tensions.
`;
      const chunks = chunkFinancialText(sampleDoc, {
        targetTokens: 50,
        overlapTokens: 10,
        baseMetadata: { symbol: 'AAPL', filingType: '10-Q' }
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].metadata.symbol).toBe('AAPL');
      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });
  });

  describe('EmbeddingClient', () => {
    let client;

    beforeEach(() => {
      client = new EmbeddingClient({ provider: 'local' });
    });

    it('should generate unit-normalized dense vectors of 384 dimensions', async () => {
      const embedding = await client.embedQuery('Apple iPhone revenue in Q3 2024');

      expect(embedding).toHaveLength(384);

      // Verify L2 unit norm: sum of squares ≈ 1.0
      const normSquared = embedding.reduce((sum, v) => sum + v * v, 0);
      expect(normSquared).toBeCloseTo(1.0, 3);
    });

    it('should calculate accurate cosine similarity', () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];

      expect(EmbeddingClient.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 4);
      expect(EmbeddingClient.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 4);
    });

    it('should produce higher similarity for semantically related financial queries', async () => {
      const v1 = await client.embedQuery('Apple quarterly revenue earnings report');
      const v2 = await client.embedQuery('Apple quarterly income and sales metrics');
      const v3 = await client.embedQuery('Federal Reserve interest rate hike announcement');

      const simRelated = EmbeddingClient.cosineSimilarity(v1, v2);
      const simUnrelated = EmbeddingClient.cosineSimilarity(v1, v3);

      expect(simRelated).toBeGreaterThan(simUnrelated);
    });
  });

  describe('BM25Retriever', () => {
    let retriever;

    beforeEach(() => {
      retriever = new BM25Retriever();
    });

    it('should tokenize and filter standard English stopwords while retaining financial metrics', () => {
      const tokens = retriever.tokenize('Apple reported $85.78B in Q3 2024 revenue with 46.3% margin');
      expect(tokens).toContain('apple');
      expect(tokens).toContain('$85.78b');
      expect(tokens).toContain('46.3%');
      expect(tokens).not.toContain('in');
      expect(tokens).not.toContain('with');
    });

    it('should rank documents containing query keywords higher', () => {
      const docs = [
        {
          _id: 'doc1',
          content: 'Tesla delivered 1.8 million electric vehicles with energy storage growth.',
          metadata: { symbol: 'TSLA' },
        },
        {
          _id: 'doc2',
          content: 'Apple reported record services revenue and iPhone sales of $39.3 billion.',
          metadata: { symbol: 'AAPL' },
        },
      ];

      const results = retriever.search('Apple iPhone services revenue', docs, { limit: 2 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].chunk._id).toBe('doc2');
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('QdrantVectorStore', () => {
    it('should generate deterministic UUID point IDs from documentId and chunkIndex', () => {
      const store = new QdrantVectorStore();
      const id1 = store._generatePointId('doc-100', 0);
      const id2 = store._generatePointId('doc-100', 0);
      const id3 = store._generatePointId('doc-100', 1);

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should report offline status gracefully when server is not running', async () => {
      const store = new QdrantVectorStore({ url: 'http://127.0.0.1:65534' });
      const ready = await store.initialize();
      expect(ready).toBe(false);

      const health = await store.checkHealth();
      expect(health.status).toBe('unreachable');
    });
  });

  describe('AgenticRAGOrchestrator', () => {
    let orchestrator;

    beforeEach(() => {
      orchestrator = new AgenticRAGOrchestrator({
        vectorStore: { hybridSearch: jest.fn().mockResolvedValue([]) },
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
      });
    });

    it('should correctly classify filing questions and extract tickers', () => {
      const c1 = orchestrator.classifyQuery('What was Apple iPhone revenue in Q3 2024?');
      expect(c1.intent).toBe('DOCUMENT_QA');
      expect(c1.symbols).toContain('AAPL');
      expect(c1.periods).toContain('Q3 2024');

      const c2 = orchestrator.classifyQuery('Compare Microsoft and Nvidia datacenter revenue in FY24');
      expect(c2.intent).toBe('COMPARISON');
      expect(c2.symbols).toContain('MSFT');
      expect(c2.symbols).toContain('NVDA');

      const c3 = orchestrator.classifyQuery('What is the current price of Tesla right now?');
      expect(c3.intent).toBe('LIVE_MARKET');
      expect(c3.requiresLiveMarket).toBe(true);
    });

    it('should generate a bounded retrieval plan for comparison questions', () => {
      const classification = {
        intent: 'COMPARISON',
        symbols: ['AAPL', 'MSFT'],
        periods: ['FY24'],
        primarySymbol: 'AAPL',
      };
      const plan = orchestrator.createRetrievalPlan('Compare Apple and Microsoft revenue', classification);
      expect(plan).toHaveLength(2);
      expect(plan[0]).toContain('AAPL');
      expect(plan[1]).toContain('MSFT');
    });

    it('should validate citations against retrieved chunks', () => {
      const mockChunks = [
        {
          chunk: {
            documentId: 'doc1',
            content: 'Apple revenue was $85.78 billion.',
            metadata: { symbol: 'AAPL', filingType: '10-Q', section: 'Operations', pageNumber: 1 },
          },
          relevanceScore: 0.95,
        },
      ];

      const answer = 'Apple achieved $85.78 billion in revenue [Source 1]. Unverified fact [Source 99].';
      const validation = orchestrator.validateCitations(answer, mockChunks);

      expect(validation.citedInText).toHaveLength(1);
      expect(validation.citedInText[0].sourceId).toBe(1);
      expect(validation.citedInText[0].symbol).toBe('AAPL');
    });
  });

  describe('SemanticCache', () => {
    it('should cache and retrieve exact query responses', async () => {
      const cache = new SemanticCache();
      const query = 'What was Nvidia data center revenue?';
      const payload = { answer: '$47.4 billion', confidence: 95 };

      await cache.set(query, null, payload, { symbol: 'NVDA' });
      const hit = await cache.get(query, null, { symbol: 'NVDA' });

      expect(hit).not.toBeNull();
      expect(hit.answer).toBe('$47.4 billion');
    });

    it('should isolate cached queries across different organizations', async () => {
      const cache = new SemanticCache();
      const query = 'Confidential executive report';
      const payload = { answer: 'Secret Data Org 1', confidence: 90 };

      await cache.set(query, null, payload, { symbol: 'INTERNAL', organizationId: 'org-1' });

      // Org 1 should get cache hit
      const hitOrg1 = await cache.get(query, null, { symbol: 'INTERNAL', organizationId: 'org-1' });
      expect(hitOrg1).not.toBeNull();
      expect(hitOrg1.answer).toBe('Secret Data Org 1');

      // Org 2 should get cache miss
      const hitOrg2 = await cache.get(query, null, { symbol: 'INTERNAL', organizationId: 'org-2' });
      expect(hitOrg2).toBeNull();
    });
  });

  describe('LiteLLMGateway & LangSmithTracer', () => {
    it('should transparently pass through to default client when LiteLLM is disabled', async () => {
      const mockGroq = { generateContent: jest.fn().mockResolvedValue('Groq Output') };
      const gateway = new LiteLLMGateway({ enabled: false, defaultClient: mockGroq });

      const res = await gateway.generateContent('Hello');
      expect(res).toBe('Groq Output');
      expect(mockGroq.generateContent).toHaveBeenCalledWith('Hello', {});
    });

    it('should support LiteLLM provider routing with OpenAI-compatible payload and headers', async () => {
      const axiosPostSpy = jest.spyOn(axios, 'post').mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'LiteLLM Routed Output' } }],
        },
      });

      const gateway = new LiteLLMGateway({
        enabled: true,
        baseUrl: 'http://localhost:8000/v1',
        apiKey: 'sk-globalfit-ulttra-master',
      });

      const res = await gateway.generateContent('Explain market volatility', {
        model: 'groq/llama-3.3-70b-versatile',
        maxTokens: 512,
      });

      expect(res).toBe('LiteLLM Routed Output');
      expect(axiosPostSpy).toHaveBeenCalledWith(
        'http://localhost:8000/v1/chat/completions',
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Explain market volatility' }],
          model: 'groq/llama-3.3-70b-versatile',
          max_tokens: 512,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-globalfit-ulttra-master',
            'Content-Type': 'application/json',
          }),
        })
      );
      axiosPostSpy.mockRestore();
    });

    it('should fall back to defaultClient if LiteLLM gateway request fails', async () => {
      const axiosPostSpy = jest.spyOn(axios, 'post').mockRejectedValueOnce(new Error('Connection refused'));
      const mockGroq = { generateContent: jest.fn().mockResolvedValue('Fallback Direct Groq') };

      const gateway = new LiteLLMGateway({
        enabled: true,
        baseUrl: 'http://localhost:8000/v1',
        defaultClient: mockGroq,
      });

      const res = await gateway.generateContent('Query');
      expect(res).toBe('Fallback Direct Groq');
      expect(mockGroq.generateContent).toHaveBeenCalledWith('Query', {});
      axiosPostSpy.mockRestore();
    });

    it('should export LiteLLMGateway as default export', () => {
      expect(LiteLLMGateway).toBeDefined();
      expect(typeof LiteLLMGateway).toBe('function');
    });

    it('should generate run IDs without throwing when LangSmith is disabled', () => {
      const tracer = new LangSmithTracer({ enabled: false });
      const runId = tracer.startRun({ name: 'Test' });
      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');
      tracer.endRun(runId, { outputs: { status: 'ok' } });
    });
  });

  describe('RerankerClient', () => {
    it('should boost candidate chunks that match query financial entities and sections', async () => {
      const reranker = new RerankerClient();
      const candidates = [
        {
          chunk: {
            content: 'Nvidia gaming revenue was $10.4 billion.',
            metadata: { section: 'Gaming Platform', symbol: 'NVDA' }
          },
          rrfScore: 0.5
        },
        {
          chunk: {
            content: 'Nvidia Compute & Networking Data Center revenue reached $47,405 million (+217%).',
            metadata: { section: 'Data Center Platform', symbol: 'NVDA' }
          },
          rrfScore: 0.5
        }
      ];

      const ranked = await reranker.rerank('What was Nvidia Data Center revenue?', candidates, 2);

      expect(ranked[0].chunk.metadata.section).toBe('Data Center Platform');
      expect(ranked[0].relevanceScore).toBeGreaterThan(ranked[1].relevanceScore);
    });
  });

  describe('RAGService', () => {
    it('should return grounded answers with structured citations', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockResolvedValue([
          {
            chunk: {
              _id: 'chunk-123',
              documentId: 'doc-123',
              content: 'Net sales for the third quarter of fiscal 2024 were $85.78 billion. Services revenue reached $24.2 billion.',
              metadata: {
                title: 'Apple 10-Q',
                symbol: 'AAPL',
                filingType: '10-Q',
                section: 'Statements of Operations',
                pageNumber: 1
              }
            },
            rrfScore: 0.85,
            score: 0.85
          }
        ])
      };

      const mockEmbeddingClient = {
        embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.05)),
      };

      const mockGroqClient = {
        generateContent: jest.fn().mockResolvedValue(
          'In Q3 2024, Apple net sales reached $85.78 billion [Source 1], driven by record Services revenue of $24.2 billion [Source 1].'
        )
      };

      const ragService = new RAGService({
        groqClient: mockGroqClient,
        embeddingClient: mockEmbeddingClient,
        vectorStore: mockVectorStore,
        semanticCache: null,
      });

      const res = await ragService.query({
        question: "What were Apple's Q3 2024 revenue numbers?",
        symbol: 'AAPL',
      });

      expect(res.answer).toContain('85.78 billion');
      expect(res.citations).toHaveLength(1);
      expect(res.citations[0].symbol).toBe('AAPL');
      expect(res.citations[0].section).toBe('Statements of Operations');
      expect(res.confidence).toBeGreaterThan(0);
    });
  });

  describe('RAG Routes', () => {
    let app;
    let mockRAGController;
    const testAdminToken = jwt.sign(
      { userId: 'admin-123', role: 'Admin', organizationId: 'org-test' },
      config.auth.jwtAccessSecret,
      { expiresIn: '1h' }
    );

    beforeEach(() => {
      mockRAGController = {
        query: (req, res) => res.json({ success: true, data: { answer: 'Mocked RAG Answer' } }),
        ingest: (req, res) => res.json({ success: true, message: 'Ingested' }),
        listDocuments: (req, res) => res.json({ success: true, data: { documents: [] } }),
        getDocument: (req, res) => res.json({ success: true, data: {} }),
        deleteDocument: (req, res) => res.json({ success: true }),
        getStats: (req, res) => res.json({ success: true, data: { totalDocuments: 5 } }),
        getHealth: (req, res) => res.json({ success: true, status: 'healthy' }),
        reindex: (req, res) => res.json({ success: true, message: 'Re-indexed' }),
        getJob: (req, res) => res.json({ success: true, data: { jobId: req.params.jobId, status: 'completed' } }),
      };

      app = express();
      app.use(express.json());
      app.use('/api/v1/rag', createRAGRoutes(mockRAGController));
    });

    it('should route query requests to ragController', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .send({ question: "What is Apple's revenue?" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBe('Mocked RAG Answer');
    });

    it('should route health check requests to ragController', async () => {
      const res = await request(app)
        .get('/api/v1/rag/health')
        .set('Authorization', `Bearer ${testAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    it('should route reindex requests to ragController for admin', async () => {
      const res = await request(app)
        .post('/api/v1/rag/reindex')
        .set('Authorization', `Bearer ${testAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Re-indexed');
    });

    it('should route job status requests to ragController', async () => {
      const res = await request(app)
        .get('/api/v1/rag/jobs/job-123')
        .set('Authorization', `Bearer ${testAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.jobId).toBe('job-123');
    });

    it('should validate request body and reject questions under 2 characters', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .send({ question: 'a' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('E1008');
    });

    it('should return 503 when ragController is null', async () => {
      const disabledApp = express();
      disabledApp.use(express.json());
      disabledApp.use('/api/v1/rag', createRAGRoutes(null));

      const res = await request(disabledApp)
        .post('/api/v1/rag/query')
        .set('Authorization', `Bearer ${testAdminToken}`)
        .send({ question: 'Valid question?' });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('E5003');
    });
  });

  describe('Agentic Iterative Retrieval and Sufficiency Bounds', () => {
    it('should iterate and relax constraints when initial retrieval is insufficient', async () => {
      let callCount = 0;
      const mockVectorStore = {
        hybridSearch: jest.fn().mockImplementation(async ({ filterOptions }) => {
          callCount++;
          // First call with strict filingType returns weak/no evidence
          if (filterOptions.filingType === '10-K') {
            return [];
          }
          // Relaxed call returns verified evidence
          return [
            {
              chunk: {
                _id: 'chunk-relaxed',
                documentId: 'doc-relaxed',
                content: 'Apple Q3 2024 revenue was $85.78 billion.',
                metadata: { symbol: 'AAPL', filingType: '10-Q', section: 'Operations', pageNumber: 1 },
              },
              rrfScore: 0.90,
            },
          ];
        }),
      };

      const orchestrator = new AgenticRAGOrchestrator({
        vectorStore: mockVectorStore,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        config: { maxAgentIterations: 3, retrieval: { minSimilarityScore: 0.40 } },
      });

      const res = await orchestrator.run({
        question: 'What was Apple revenue?',
        symbol: 'AAPL',
        filingType: '10-K',
      });

      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(res.confidence).toBeGreaterThanOrEqual(40);
      expect(res.citations).toHaveLength(1);
      expect(res.agentTrace.some(t => t.stage === 'RETRIEVAL_IMPROVEMENT')).toBe(true);
    });

    it('should safely refuse without hallucinating when evidence is insufficient across all iterations', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockResolvedValue([]),
      };

      const orchestrator = new AgenticRAGOrchestrator({
        vectorStore: mockVectorStore,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        config: { maxAgentIterations: 3, retrieval: { minSimilarityScore: 0.40 } },
      });

      const res = await orchestrator.run({
        question: 'What was Boeing commercial aircraft deliveries in 2024?',
        symbol: 'BA',
      });

      expect(res.citations).toHaveLength(0);
      expect(res.confidence).toBe(0);
      expect(res.answer).toContain('No matching financial filings found');
    });
  });

  describe('IngestionService Path Traversal Protection', () => {
    it('should reject file paths that traverse outside the repository directory', () => {
      const ingestion = new IngestionService({
        embeddingClient: { embedBatch: jest.fn() },
      });

      expect(() => {
        ingestion._validateAndResolvePath('../../../../../etc/passwd');
      }).toThrow(/Access denied/);

      expect(() => {
        ingestion._validateAndResolvePath('C:\\Windows\\System32\\drivers\\etc\\hosts');
      }).toThrow(/Access denied/);
    });

    it('should reject file paths containing null byte injections', () => {
      const ingestion = new IngestionService({
        embeddingClient: { embedBatch: jest.fn() },
      });

      expect(() => {
        ingestion._validateAndResolvePath('data/financial_documents/AAPL\0.pdf');
      }).toThrow(/Null byte detected/);
    });
  });

  describe('RAGService.streamQuery Real-Time Token & Citation Streaming', () => {
    it('should stream citations first, then tokens, and trigger onComplete', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockResolvedValue([
          {
            chunk: {
              _id: 'stream-c1',
              documentId: 'doc-stream-1',
              content: 'Nvidia Data Center revenue reached $47.4B.',
              metadata: { symbol: 'NVDA', filingType: '10-K', section: 'Data Center', pageNumber: 1 },
            },
            rrfScore: 0.95,
          },
        ]),
      };

      const streamedTokens = [];
      let capturedCitations = null;
      let completed = false;

      const mockGroqClient = {
        streamContent: jest.fn().mockImplementation(async (prompt, onChunk) => {
          await onChunk('Nvidia ');
          await onChunk('Data Center ');
          await onChunk('reached $47.4B [Source 1].');
        }),
      };

      const ragService = new RAGService({
        groqClient: mockGroqClient,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        vectorStore: mockVectorStore,
      });

      await ragService.streamQuery({
        question: 'What was Nvidia Data Center revenue?',
        symbol: 'NVDA',
        onCitations: (citations) => { capturedCitations = citations; },
        onToken: (token) => { streamedTokens.push(token); },
        onComplete: ({ citations: _c }) => { completed = true; },
      });

      expect(capturedCitations).toHaveLength(1);
      expect(capturedCitations[0].symbol).toBe('NVDA');
      expect(streamedTokens.join('')).toBe('Nvidia Data Center reached $47.4B [Source 1].');
      expect(completed).toBe(true);
    });

    it('should refuse safely without invoking LLM streaming when evidence is insufficient', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockResolvedValue([]),
      };

      const streamedTokens = [];
      let completed = false;
      const mockGroqClient = {
        streamContent: jest.fn(),
      };

      const ragService = new RAGService({
        groqClient: mockGroqClient,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        vectorStore: mockVectorStore,
      });

      await ragService.streamQuery({
        question: 'What was Boeing revenue in 2024?',
        symbol: 'BA',
        onToken: (token) => { streamedTokens.push(token); },
        onComplete: () => { completed = true; },
      });

      expect(mockGroqClient.streamContent).not.toHaveBeenCalled();
      expect(streamedTokens.length).toBeGreaterThan(0);
      expect(streamedTokens[0]).toContain('No matching financial filings found');
      expect(completed).toBe(true);
    });
  });

  describe('LiteLLMGateway streamContent', () => {
    it('should delegate streamContent to defaultClient when disabled', async () => {
      const chunks = [];
      const mockDefault = {
        streamContent: jest.fn().mockImplementation(async (prompt, onChunk) => {
          await onChunk('Token A ');
          await onChunk('Token B');
          return 'Token A Token B';
        }),
      };

      const gateway = new LiteLLMGateway({ enabled: false, defaultClient: mockDefault });
      const res = await gateway.streamContent('Prompt', (c) => chunks.push(c));

      expect(mockDefault.streamContent).toHaveBeenCalled();
      expect(chunks.join('')).toBe('Token A Token B');
      expect(res).toBe('Token A Token B');
    });
  });

  describe('Document Schema FileType Validation', () => {
    it('should accept md and markdown in Document fileType enum', () => {
      const docMd = new Document({
        title: 'Markdown Filing',
        filename: 'filing.md',
        fileType: 'md',
        sha256Hash: 'hash123',
      });
      const error = docMd.validateSync();
      expect(error?.errors?.fileType).toBeUndefined();

      const docMarkdown = new Document({
        title: 'Markdown Filing Full',
        filename: 'filing.markdown',
        fileType: 'markdown',
        sha256Hash: 'hash456',
      });
      const error2 = docMarkdown.validateSync();
      expect(error2?.errors?.fileType).toBeUndefined();
    });
  });

  describe('Comprehensive RAG Edge Cases & Resilience', () => {
    it('should generate unit-normalized 384-dimensional dense vectors with _embedFallbackProjection', () => {
      const client = new EmbeddingClient({ provider: 'local' });
      const [vector] = client._embedFallbackProjection(['Apple Q3 revenue $85.78B']);

      expect(Array.isArray(vector)).toBe(true);
      expect(vector).toHaveLength(384);
      let sumSq = 0;
      for (let i = 0; i < vector.length; i++) sumSq += vector[i] * vector[i];
      expect(sumSq).toBeCloseTo(1.0, 3);
    });

    it('should fall back to in-database cosine search when Qdrant store searchDense throws', async () => {
      const mockQdrant = {
        isReady: true,
        searchDense: jest.fn().mockRejectedValue(new Error('Qdrant daemon connection refused')),
      };

      const mockModel = {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  _id: 'mongo-c1',
                  documentId: 'doc1',
                  content: 'Microsoft Azure cloud revenue',
                  embedding: new Array(384).fill(0.1),
                  metadata: { symbol: 'MSFT', filingType: '10-K' },
                },
              ]),
            }),
          }),
        }),
      };

      const store = new VectorStore({
        documentChunkModel: mockModel,
        qdrantVectorStore: mockQdrant,
      });

      const results = await store.searchDense(new Array(384).fill(0.1), { limit: 1 });
      expect(mockQdrant.searchDense).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].chunk._id).toBe('mongo-c1');
    });

    it('should fall back to local cross-encoder scoring when Cohere rerank API fails', async () => {
      const reranker = new RerankerClient({ apiKey: 'mock-cohere-key' });
      const candidates = [
        { chunk: { content: 'Apple Services revenue $24.2B', metadata: { section: 'Operations' } }, denseScore: 0.5 },
        { chunk: { content: 'Unrelated paragraph about office furniture', metadata: { section: 'General' } }, denseScore: 0.3 },
      ];

      const results = await reranker.rerank('Apple Services revenue', candidates, 2);
      expect(results).toHaveLength(2);
      expect(results[0].chunk.content).toContain('Apple Services');
      expect(results[0].relevanceScore).toBeGreaterThan(results[1].relevanceScore);
    });

    it('should handle LLM synthesis failure gracefully and return retrieved context', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockResolvedValue([
          {
            chunk: {
              _id: 'c1',
              documentId: 'd1',
              content: 'Nvidia Data Center revenue was $47.4B.',
              metadata: { symbol: 'NVDA', filingType: '10-K', section: 'Data Center', pageNumber: 1 },
            },
            rrfScore: 0.95,
          },
        ]),
      };

      const mockFailingGroq = {
        generateContent: jest.fn().mockRejectedValue(new Error('Rate limit exceeded (TPM)')),
      };

      const orchestrator = new AgenticRAGOrchestrator({
        vectorStore: mockVectorStore,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        groqClient: mockFailingGroq,
      });

      const res = await orchestrator.run({
        question: 'What was Nvidia revenue?',
        symbol: 'NVDA',
      });

      expect(mockFailingGroq.generateContent).toHaveBeenCalled();
      expect(res.answer).toContain('LLM synthesis was unavailable');
      expect(res.retrievalCount).toBe(1);
    });

    it('should route live market inquiries to FinancialDataService', async () => {
      const mockFinancialDataService = {
        getQuote: jest.fn().mockResolvedValue({
          symbol: 'AAPL',
          price: 232.50,
          change: 3.20,
          changePercent: 1.39,
        }),
      };

      const orchestrator = new AgenticRAGOrchestrator({
        vectorStore: { hybridSearch: jest.fn() },
        embeddingClient: { embedQuery: jest.fn() },
        financialDataService: mockFinancialDataService,
      });

      const res = await orchestrator.run({
        question: "What is Apple's current stock price right now?",
        symbol: 'AAPL',
      });

      expect(mockFinancialDataService.getQuote).toHaveBeenCalledWith('AAPL');
      expect(res.answer).toContain('Live Market Data for AAPL');
      expect(res.answer).toContain('$232.5');
      expect(res.confidence).toBe(99);
    });

    it('should enforce timeout boundary and terminate iteration loop', async () => {
      const mockVectorStore = {
        hybridSearch: jest.fn().mockImplementation(async () => {
          return [];
        }),
      };

      const orchestrator = new AgenticRAGOrchestrator({
        vectorStore: mockVectorStore,
        embeddingClient: { embedQuery: jest.fn().mockResolvedValue(new Array(384).fill(0.1)) },
        config: { maxAgentIterations: 5, timeoutMs: 0 },
      });

      const res = await orchestrator.run({
        question: 'Any financial query?',
        symbol: 'AAPL',
      });

      expect(res.agentTrace.some(t => t.stage === 'TIMEOUT')).toBe(true);
      expect(res.confidence).toBe(0);
    });

    it('should fall back to in-memory caching when Redis cache throws', async () => {
      const mockFailingRedis = {
        get: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
        set: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
      };

      const cache = new SemanticCache({ cacheService: mockFailingRedis });

      // Should not throw on set
      await cache.set('What is AAPL revenue?', new Array(384).fill(0.1), { answer: '$85.78B' });

      // Should read from memory without throwing
      const res = await cache.get('What is AAPL revenue?', new Array(384).fill(0.1));
      expect(res).not.toBeNull();
      expect(res.answer).toBe('$85.78B');
    });
  });
});

