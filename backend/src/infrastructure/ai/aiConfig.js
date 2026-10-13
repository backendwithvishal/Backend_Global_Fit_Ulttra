/**
 * AI Service Configuration
 * 
 * Central configuration for Groq AI integration including model selection,
 * retry strategies, timeouts, and rate limiting.
 * 
 * @module infrastructure/ai/aiConfig
 */

export const AI_CONFIG = {
  // Model selection
  models: {
    primary: process.env.GROQ_PRIMARY_MODEL || 'llama-3.3-70b-versatile',    // Complex analysis, reasoning
    fast: process.env.GROQ_FAST_MODEL || 'llama-3.1-8b-instant',          // Simple tasks, quick responses
    fallback: 'llama-guard-4-12b'          // Safety checks (if needed)
  },

  // Retry configuration
  retries: {
    maxAttempts: 3,
    initialBackoffMs: 1000,      // 1 second
    maxBackoffMs: 10000,         // 10 seconds
    backoffMultiplier: 2         // Exponential backoff
  },

  // Timeout configuration
  timeouts: {
    standard: 30000,             // 30 seconds for normal requests
    streaming: 60000,            // 60 seconds for streaming
    complex: 45000               // 45 seconds for complex analysis
  },

  // Rate limiting (Groq free tier)
  rateLimit: {
    primary: {
      tokensPerMinute: 300000,   // 300K TPM
      requestsPerMinute: 1000    // 1K RPM
    },
    fast: {
      tokensPerMinute: 250000,   // 250K TPM
      requestsPerMinute: 1000    // 1K RPM
    }
  },

  // Generation parameters
  generation: {
    temperature: 0.7,            // Balance creativity and consistency
    maxTokens: 1024,             // Default max output
    topP: 0.9,                   // Nucleus sampling
    streamChunkSize: 1           // Tokens per chunk in streaming
  },

  // Cache configuration
  cache: {
    enabled: true,
    ttl: {
      standard: 3600,            // 1 hour for standard responses
      news: 300,                 // 5 minutes for news analysis
      insights: 900,             // 15 minutes for market insights
      recommendations: 21600     // 6 hours for recommendations
    }
  },

  // Task complexity mapping
  taskComplexity: {
    simple: [
      'sentiment_classification',
      'entity_extraction',
      'keyword_extraction',
      'yes_no_answer',
      'simple_categorization'
    ],
    complex: [
      'market_analysis',
      'multi_document_synthesis',
      'reasoning_chain',
      'recommendation_generation',
      'comparative_analysis',
      'trend_prediction'
    ]
  },

  // RAG Pipeline Configuration
  rag: {
    chunking: {
      chunkSize: 600,            // Target tokens per chunk
      chunkOverlap: 80,          // Token overlap between chunks
      maxTokensPerChunk: 1000,   // Hard upper bound
    },
    retrieval: {
      initialCandidates: 25,     // Stage 1: Vector + keyword candidates
      topK: 4,                   // Stage 2: Reranked chunks passed to LLM
      minSimilarityScore: 0.55,  // Rejection threshold for weak matches
      rrfConstant: 60,           // Reciprocal Rank Fusion constant
      denseWeight: 0.65,         // Weight for vector cosine similarity
      sparseWeight: 0.35,        // Weight for BM25/keyword similarity
    },
    semanticCache: {
      similarityThreshold: 0.90, // Cosine similarity required for cache hit
      ttl: 86400,                // 24 hours
    },
    embedding: {
      dimensions: 384,           // Dense embedding dimension (384 for local, 1536 for OpenAI)
      batchSize: 32,             // Max chunks per embedding batch
    }
  }
};

export default AI_CONFIG;
