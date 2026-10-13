/**
 * Global-Fi Ultra - RAG Unit Tests
 * 
 * Tests for financial chunker, embedding vectorizer, semantic cache,
 * reranker, and RAG service orchestration.
 * 
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import { chunkFinancialText, detectSection, isTableBlock } from '../../src/utils/financialChunker.js';
import { EmbeddingClient } from '../../src/infrastructure/ai/EmbeddingClient.js';
import { SemanticCache } from '../../src/infrastructure/cache/SemanticCache.js';
import { RerankerClient } from '../../src/infrastructure/ai/RerankerClient.js';
import { RAGService } from '../../src/services/RAGService.js';
import express from 'express';
import request from 'supertest';
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

    beforeEach(() => {
      mockRAGController = {
        query: (req, res) => res.json({ success: true, data: { answer: 'Mocked RAG Answer' } }),
        ingest: (req, res) => res.json({ success: true, message: 'Ingested' }),
        listDocuments: (req, res) => res.json({ success: true, data: { documents: [] } }),
        getDocument: (req, res) => res.json({ success: true, data: {} }),
        deleteDocument: (req, res) => res.json({ success: true }),
        getStats: (req, res) => res.json({ success: true, data: { totalDocuments: 5 } }),
      };

      app = express();
      app.use(express.json());
      app.use('/api/v1/rag', createRAGRoutes(mockRAGController));
    });

    it('should route query requests to ragController', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
        .send({ question: "What is Apple's revenue?" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toBe('Mocked RAG Answer');
    });

    it('should validate request body and reject questions under 2 characters', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
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
        .send({ question: 'Valid question?' });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('E5003');
    });
  });
});
