/**
 * Global_Fit_Ulttra - RAG Orchestration Service
 * 
 * Production Agentic RAG engine for financial research, SEC filings, and market intelligence:
 * 1. Redis Semantic Cache (<30ms query responses with strict tenant isolation).
 * 2. Agentic Query Understanding, Classification & Live Market Routing.
 * 3. Bounded Multi-Step Retrieval Planning.
 * 4. Two-Stage Retrieval (Dense Qdrant/MongoDB Vector + BM25 Sparse Search + Reciprocal Rank Fusion).
 * 5. Cross-Encoder Density Reranking for pinpoint contextual precision.
 * 6. Evidence Sufficiency Verification (prevents hallucination on missing data).
 * 7. Grounded Synthesis via Groq / LiteLLM Gateway with Anti-Injection Guardrails.
 * 8. Strict Citation Attribution & Verification ([Source 1: AAPL 10-K]).
 * 9. Real-Time Token & Citation Streaming over WebSockets (Socket.IO).
 * 10. LangSmith Tracing & Observability.
 * 
 * @module services/RAGService
 */

import { logger } from '../config/logger.js';
import { AI_CONFIG } from '../infrastructure/ai/aiConfig.js';
import { AgenticRAGOrchestrator } from '../infrastructure/ai/AgenticRAGOrchestrator.js';
import { sanitizeForPrompt } from '../middleware/aiQuotaMiddleware.js';

export class RAGService {
  constructor({
    groqClient,
    embeddingClient,
    vectorStore,
    rerankerClient = null,
    semanticCache = null,
    financialDataService = null,
    aiGateway = null,
    langSmithTracer = null,
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
    this.financialDataService = financialDataService;
    this.aiGateway = aiGateway;
    this.langSmithTracer = langSmithTracer;
    this.logger = logger || console;
    this.config = AI_CONFIG.rag || {};

    // Instantiate Agentic Orchestrator
    const activeLLMClient = this.aiGateway && this.aiGateway.enabled
      ? this.aiGateway
      : this.groqClient;

    this.orchestrator = new AgenticRAGOrchestrator({
      vectorStore: this.vectorStore,
      embeddingClient: this.embeddingClient,
      rerankerClient: this.rerankerClient,
      groqClient: activeLLMClient,
      financialDataService: this.financialDataService,
      config: this.config,
    });
  }

  /**
   * Automatically extracts ticker symbols from query if not provided.
   */
  _extractSymbolFromQuery(query) {
    if (!query) return null;
    const classification = this.orchestrator.classifyQuery(query);
    return classification.primarySymbol !== 'ALL' ? classification.primarySymbol : null;
  }

  /**
   * Executes a grounded Agentic RAG query.
   * 
   * @param {object} params
   * @param {string} params.question - Financial question
   * @param {string} [params.symbol] - Stock/asset ticker
   * @param {string} [params.filingType] - 10-K, 10-Q, FOMC, etc.
   * @param {number} [params.topK=4] - Number of context chunks
   * @param {string} [params.organizationId] - Multi-tenant isolation
   * @param {boolean} [params.bypassCache=false]
   * @param {string} [params.requestId]
   * @returns {Promise<object>} Grounded answer + verified citations
   */
  async query({
    question,
    symbol = null,
    filingType = null,
    topK = 4,
    organizationId = null,
    bypassCache = false,
    requestId = null,
  }) {
    const startTime = Date.now();
    const cleanQuestion = (question || '').trim();

    if (!cleanQuestion) {
      throw new Error('Question is required for RAG query');
    }

    const targetSymbol = (symbol || this._extractSymbolFromQuery(cleanQuestion) || 'ALL').toUpperCase();

    // 1. Check Semantic Cache
    let queryEmbedding = null;
    if (this.semanticCache && !bypassCache) {
      try {
        queryEmbedding = await this.embeddingClient.embedQuery(cleanQuestion);
        const cached = await this.semanticCache.get(cleanQuestion, queryEmbedding, {
          symbol: targetSymbol,
          filingType,
          organizationId,
        });

        if (cached) {
          if (this.langSmithTracer) {
            this.langSmithTracer.traceRAGExecution({
              requestId,
              question: cleanQuestion,
              classification: { symbol: targetSymbol },
              plan: ['Cache retrieval'],
              retrievalCount: cached.retrievalCount || 0,
              confidence: cached.confidence || 95,
              citationsCount: cached.citations?.length || 0,
              latencyMs: Date.now() - startTime,
              cached: true,
            });
          }

          return {
            ...cached,
            latencyMs: Date.now() - startTime,
            cached: true,
          };
        }
      } catch (err) {
        this.logger.debug('Semantic cache lookup skipped', { error: err.message });
      }
    }

    // 2. Execute Controlled Agentic Orchestration
    const agentResult = await this.orchestrator.run({
      question: cleanQuestion,
      symbol: targetSymbol !== 'ALL' ? targetSymbol : null,
      filingType,
      topK,
      organizationId,
    });

    const responsePayload = {
      ...agentResult,
      symbol: targetSymbol,
      cached: false,
    };

    // 3. Store response in Semantic Cache if sufficiently confident
    if (this.semanticCache && agentResult.confidence >= 50) {
      try {
        if (!queryEmbedding) {
          queryEmbedding = await this.embeddingClient.embedQuery(cleanQuestion);
        }
        await this.semanticCache.set(cleanQuestion, queryEmbedding, responsePayload, {
          symbol: targetSymbol,
          filingType,
          organizationId,
        });
      } catch (err) {
        this.logger.debug('Failed to write to semantic cache', { error: err.message });
      }
    }

    // 4. Asynchronously trace to LangSmith
    if (this.langSmithTracer) {
      this.langSmithTracer.traceRAGExecution({
        requestId,
        question: cleanQuestion,
        classification: agentResult.agentTrace?.[0]?.result,
        plan: agentResult.agentTrace?.[1]?.subQueries,
        retrievalCount: agentResult.retrievalCount,
        confidence: agentResult.confidence,
        citationsCount: agentResult.citations?.length || 0,
        latencyMs: Date.now() - startTime,
        cached: false,
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
    organizationId = null,
    onToken,
    onCitations,
    onComplete,
    onError,
  }) {
    try {
      const cleanQuestion = (question || '').trim();
      const classification = this.orchestrator.classifyQuery(cleanQuestion, symbol);
      const targetSymbol = classification.primarySymbol;

      const subQueries = this.orchestrator.createRetrievalPlan(cleanQuestion, classification);
      const topChunks = await this.orchestrator.retrieveEvidence({
        subQueries,
        classification,
        filterOptions: {
          symbol: targetSymbol !== 'ALL' ? targetSymbol : undefined,
          organizationId: organizationId || null,
        },
        topK: 4,
      });

      const sufficiency = this.orchestrator.evaluateEvidenceSufficiency(topChunks);
      if (!sufficiency.isSufficient) {
        if (typeof onToken === 'function') onToken(sufficiency.reason);
        if (typeof onComplete === 'function') onComplete({ citations: [] });
        return;
      }

      // Format and emit verified citations immediately before streaming tokens
      const citationValidation = this.orchestrator.validateCitations('', topChunks);
      const citations = citationValidation.allAvailableCitations;

      if (typeof onCitations === 'function') {
        onCitations(citations);
      }

      const contextText = topChunks.map((c, i) => `[Source ${i+1}: ${c.chunk.metadata?.symbol || 'GENERAL'} - ${c.chunk.metadata?.section || 'Section'}]\n${sanitizeForPrompt(c.chunk.content)}`).join('\n\n');

      const streamPrompt = `You are Global_Fit_Ulttra's Senior Financial Research Analyst.
Context:
${contextText}

Question: ${sanitizeForPrompt(cleanQuestion)}

Provide a grounded financial analysis citing [Source X]:`;

      const activeLLMClient = this.aiGateway && this.aiGateway.enabled
        ? this.aiGateway
        : this.groqClient;

      if (activeLLMClient && typeof activeLLMClient.streamContent === 'function') {
        await activeLLMClient.streamContent(
          streamPrompt,
          (chunk) => {
            if (typeof onToken === 'function') onToken(chunk);
          },
          { complex: true }
        );
        if (typeof onComplete === 'function') onComplete({ citations });
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
