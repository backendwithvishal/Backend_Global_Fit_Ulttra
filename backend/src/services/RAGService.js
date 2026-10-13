/**
 * Global-Fi Ultra - RAG Orchestration Service
 * 
 * Production RAG engine for financial research, SEC filings, and market intelligence:
 * 1. Redis Semantic Cache (<30ms query responses).
 * 2. Financial Query Expansion & Ticker Entity Extraction.
 * 3. Two-Stage Retrieval (Dense Vector + BM25 Sparse Search + Reciprocal Rank Fusion).
 * 4. Cross-Encoder Reranking for pinpoint contextual precision.
 * 5. Grounded Prompt Synthesis with Strict Hallucination Guardrails.
 * 6. Automated Source & Citation Attribution ([Source 1: AAPL 10-K]).
 * 7. Real-Time Token & Citation Streaming over WebSockets/SSE.
 * 
 * @module services/RAGService
 */

import { logger } from '../config/logger.js';
import { AI_CONFIG } from '../infrastructure/ai/aiConfig.js';

export class RAGService {
  constructor({
    groqClient,
    embeddingClient,
    vectorStore,
    rerankerClient,
    semanticCache,
  } = {}) {
    if (!vectorStore) {
      throw new Error('VectorStore is required for RAGService');
    }
    if (!embeddingClient) {
      throw new Error('EmbeddingClient is required for RAGService');
    }

    this.groqClient = groqClient;
    this.embeddingClient = embeddingClient;
    this.vectorStore = vectorStore;
    this.rerankerClient = rerankerClient;
    this.semanticCache = semanticCache;
    this.logger = logger || console;
    this.config = AI_CONFIG.rag || {};
  }

  /**
   * Automatically extracts ticker symbols from query if not provided.
   */
  _extractSymbolFromQuery(query) {
    if (!query) return null;
    const q = query.toUpperCase();
    if (q.includes('APPLE') || /\bAAPL\b/.test(q)) return 'AAPL';
    if (q.includes('MICROSOFT') || /\bMSFT\b/.test(q)) return 'MSFT';
    if (q.includes('NVIDIA') || /\bNVDA\b/.test(q)) return 'NVDA';
    if (q.includes('TESLA') || /\bTSLA\b/.test(q)) return 'TSLA';
    if (q.includes('FED') || q.includes('FOMC') || q.includes('INTEREST RATE') || q.includes('INFLATION')) return 'FED';
    if (q.includes('AMAZON') || /\bAMZN\b/.test(q)) return 'AMZN';
    return null;
  }

  /**
   * Executes a grounded RAG query.
   * 
   * @param {object} params
   * @param {string} params.question - Financial question
   * @param {string} [params.symbol] - Stock/asset ticker
   * @param {string} [params.filingType] - 10-K, 10-Q, FOMC, etc.
   * @param {number} [params.topK=4] - Number of context chunks
   * @param {string} [params.organizationId] - Multi-tenant isolation
   * @param {boolean} [params.bypassCache=false]
   * @returns {Promise<object>} Grounded answer + citations
   */
  async query({
    question,
    symbol = null,
    filingType = null,
    topK = 4,
    organizationId = null,
    bypassCache = false,
  }) {
    const startTime = Date.now();
    const cleanQuestion = (question || '').trim();

    if (!cleanQuestion) {
      throw new Error('Question is required for RAG query');
    }

    // Auto-detect symbol if omitted
    const targetSymbol = (symbol || this._extractSymbolFromQuery(cleanQuestion) || 'ALL').toUpperCase();

    // 1. Generate Query Vector Embedding
    const queryEmbedding = await this.embeddingClient.embedQuery(cleanQuestion);

    // 2. Check Semantic Cache
    if (this.semanticCache && !bypassCache) {
      const cached = await this.semanticCache.get(cleanQuestion, queryEmbedding, {
        symbol: targetSymbol,
        filingType,
      });

      if (cached) {
        return {
          ...cached,
          latencyMs: Date.now() - startTime,
          cached: true,
        };
      }
    }

    // 3. Stage 1: Hybrid Search (Dense Vector + Sparse Keyword with RRF)
    const hybridCandidates = await this.vectorStore.hybridSearch({
      queryEmbedding,
      queryText: cleanQuestion,
      filterOptions: {
        symbol: targetSymbol !== 'ALL' ? targetSymbol : undefined,
        filingType: filingType !== 'ALL' ? filingType : undefined,
        organizationId,
      },
      limit: 20,
    });

    if (hybridCandidates.length === 0) {
      return {
        answer: 'No matching financial filings or documents were found in the knowledge repository for this asset or query.',
        citations: [],
        confidence: 0,
        retrievalCount: 0,
        latencyMs: Date.now() - startTime,
        cached: false,
      };
    }

    // 4. Stage 2: Cross-Encoder Reranking
    let topChunks = hybridCandidates;
    if (this.rerankerClient) {
      topChunks = await this.rerankerClient.rerank(cleanQuestion, hybridCandidates, topK);
    } else {
      topChunks = hybridCandidates.slice(0, topK);
    }

    // Check minimum similarity threshold to prevent hallucinations
    const bestScore = topChunks[0]?.relevanceScore || topChunks[0]?.rrfScore || 0;
    const minThreshold = this.config.retrieval?.minSimilarityScore || 0.40;

    if (bestScore < minThreshold) {
      return {
        answer: 'The financial documents in the repository do not contain sufficient evidence to answer this question with high confidence.',
        citations: [],
        confidence: Math.round(bestScore * 100),
        retrievalCount: topChunks.length,
        latencyMs: Date.now() - startTime,
        cached: false,
      };
    }

    // 5. Build Context Blocks and Citations Map
    const citations = [];
    const contextBlocks = topChunks.map((item, idx) => {
      const chunk = item.chunk;
      const sourceId = idx + 1;
      const meta = chunk.metadata || {};

      citations.push({
        sourceId,
        documentId: chunk.documentId,
        title: meta.title || 'Financial Report',
        symbol: meta.symbol || 'GENERAL',
        filingType: meta.filingType || 'REPORT',
        section: meta.section || 'General',
        pageNumber: meta.pageNumber || 1,
        relevanceScore: Math.round((item.relevanceScore || item.rrfScore || 0.8) * 100) / 100,
        snippet: (chunk.content || '').slice(0, 200) + '...',
      });

      return `[Source ${sourceId}: ${meta.symbol} (${meta.filingType}) - ${meta.section}, Page ${meta.pageNumber || 1}]\n${chunk.content}`;
    });

    const contextText = contextBlocks.join('\n\n────────────────────────────────────────\n\n');

    // 6. Assemble Grounded Prompt with Strict Financial Guardrails
    const systemPrompt = `You are Global-Fi Ultra's Senior Financial Research Analyst.
Your duty is to provide an accurate, fact-based response based STRICTLY and EXCLUSIVELY on the provided financial filings below.

STRICT INSTRUCTIONS:
1. Every major fact, revenue number, growth percentage, and risk claim MUST include a citation tag [Source X] corresponding to the source numbers in the context.
2. If the context contains specific numbers (e.g. $85.78 billion, +14% Services growth), cite the exact figure.
3. If the context does not contain the answer, reply: "The provided financial documents do not contain sufficient data to answer this question."
4. Do NOT speculate or incorporate outside market speculation beyond what is documented in the text.`;

    const userPrompt = `Financial Context:
${contextText}

Question: ${cleanQuestion}

Please provide a detailed, well-structured financial analysis with exact citations [Source X]:`;

    // 7. Generation via Groq LLM (Llama 3.3 70B)
    let answerText = '';
    if (this.groqClient) {
      try {
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        answerText = await this.groqClient.generateContent(fullPrompt, {
          complex: true,
          cache: false,
          maxTokens: 1024,
        });
      } catch (err) {
        this.logger.error('Groq LLM generation error in RAG', { error: err.message });
        answerText = `Retrieved ${topChunks.length} verified context sources, but LLM synthesis was unavailable: ${err.message}`;
      }
    } else {
      // Direct summary fallback if Groq key is not configured
      answerText = `Verified Context retrieved from ${topChunks.length} financial sources:\n\n${topChunks.map((c, i) => `[Source ${i+1}]: ${c.chunk.content}`).join('\n\n')}`;
    }

    const confidenceScore = Math.min(98, Math.round(bestScore * 100));

    const responsePayload = {
      answer: answerText.trim(),
      citations,
      symbol: targetSymbol,
      confidence: confidenceScore,
      retrievalCount: topChunks.length,
      latencyMs: Date.now() - startTime,
      cached: false,
    };

    // 8. Cache response in Redis Semantic Cache
    if (this.semanticCache) {
      await this.semanticCache.set(cleanQuestion, queryEmbedding, responsePayload, {
        symbol: targetSymbol,
        filingType,
      });
    }

    return responsePayload;
  }

  /**
   * Real-time streaming RAG query for WebSocket / SSE.
   */
  async streamQuery({
    question,
    symbol = null,
    onToken,
    onCitations,
    onComplete,
    onError,
  }) {
    try {
      const cleanQuestion = (question || '').trim();
      const targetSymbol = (symbol || this._extractSymbolFromQuery(cleanQuestion) || 'ALL').toUpperCase();

      // Embedding & Retrieval
      const queryEmbedding = await this.embeddingClient.embedQuery(cleanQuestion);

      const candidates = await this.vectorStore.hybridSearch({
        queryEmbedding,
        queryText: cleanQuestion,
        filterOptions: { symbol: targetSymbol !== 'ALL' ? targetSymbol : undefined },
        limit: 15,
      });

      const topChunks = this.rerankerClient
        ? await this.rerankerClient.rerank(cleanQuestion, candidates, 4)
        : candidates.slice(0, 4);

      const citations = topChunks.map((item, idx) => ({
        sourceId: idx + 1,
        title: item.chunk.metadata?.title || 'Filing',
        symbol: item.chunk.metadata?.symbol || 'GENERAL',
        section: item.chunk.metadata?.section || 'General',
        pageNumber: item.chunk.metadata?.pageNumber || 1,
        snippet: (item.chunk.content || '').slice(0, 150) + '...',
      }));

      // Send citations immediately before tokens stream
      if (typeof onCitations === 'function') {
        onCitations(citations);
      }

      const contextText = topChunks.map((c, i) => `[Source ${i+1}: ${c.chunk.metadata?.symbol} - ${c.chunk.metadata?.section}]\n${c.chunk.content}`).join('\n\n');

      const streamPrompt = `You are Global-Fi Ultra's Senior Financial Research Analyst.
Context:
${contextText}

Question: ${cleanQuestion}

Answer factually using citations [Source X]:`;

      if (this.groqClient && typeof this.groqClient.streamContent === 'function') {
        await this.groqClient.streamContent(streamPrompt, {
          onChunk: (chunk) => {
            if (typeof onToken === 'function') onToken(chunk);
          },
          onComplete: () => {
            if (typeof onComplete === 'function') onComplete({ citations });
          },
          onError: (err) => {
            if (typeof onError === 'function') onError(err);
          }
        });
      } else {
        if (typeof onToken === 'function') onToken(contextText);
        if (typeof onComplete === 'function') onComplete({ citations });
      }
    } catch (err) {
      if (typeof onError === 'function') onError(err);
    }
  }
}

export default RAGService;
