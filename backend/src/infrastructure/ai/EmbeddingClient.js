/**
 * Global-Fi Ultra - Embedding Client
 * 
 * Production-ready embedding generator supporting multiple providers:
 * 1. OpenAI (text-embedding-3-small, 1536 dims)
 * 2. Voyage AI (voyage-finance-2, 1024 dims)
 * 3. Local Dense Semantic Vectorizer (384 dims, zero external dependencies)
 * 
 * Includes Redis/in-memory embedding caching, batch processing, and backoff retries.
 * 
 * @module infrastructure/ai/EmbeddingClient
 */

import crypto from 'crypto';
import axios from 'axios';
import { logger } from '../../config/logger.js';
import { AI_CONFIG } from './aiConfig.js';

export class EmbeddingClient {
  constructor({
    provider = 'local',
    apiKey = '',
    model = 'text-embedding-3-small',
    cacheService = null,
  } = {}) {
    this.provider = (provider || 'local').toLowerCase();
    this.apiKey = apiKey || '';
    this.model = model || 'text-embedding-3-small';
    this.cacheService = cacheService;
    this.logger = logger || console;

    // Set vector dimensions based on provider
    if (this.provider === 'openai' && this.apiKey) {
      this.dimensions = 1536;
    } else if (this.provider === 'voyage' && this.apiKey) {
      this.dimensions = 1024;
    } else {
      this.provider = 'local';
      this.dimensions = AI_CONFIG.rag?.embedding?.dimensions || 384;
    }

    this.logger.info('EmbeddingClient initialized', {
      provider: this.provider,
      dimensions: this.dimensions,
      model: this.model,
      cacheEnabled: !!this.cacheService,
    });
  }

  /**
   * Generates a cache key for an input string.
   */
  _getCacheKey(text) {
    const hash = crypto.createHash('sha256').update(`${this.provider}:${this.model}:${text}`).digest('hex');
    return `rag:embedding:${hash}`;
  }

  /**
   * Generates embedding for a single text string.
   * @param {string} text 
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  /**
   * Generates embeddings for an array of text chunks with caching and batching.
   * @param {string[]} texts 
   * @returns {Promise<number[][]>}
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    const results = new Array(texts.length);
    const missingIndices = [];
    const missingTexts = [];

    // 1. Check cache first
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (this.cacheService) {
        try {
          const cacheKey = this._getCacheKey(text);
          const cached = await this.cacheService.get(cacheKey);
          if (cached && Array.isArray(cached) && cached.length === this.dimensions) {
            results[i] = cached;
            continue;
          }
        } catch {
          // Cache miss / error: continue to generation
        }
      }
      missingIndices.push(i);
      missingTexts.push(text);
    }

    if (missingTexts.length === 0) {
      return results;
    }

    // 2. Compute missing embeddings
    let computedEmbeddings = [];
    if (this.provider === 'openai' && this.apiKey) {
      computedEmbeddings = await this._embedOpenAI(missingTexts);
    } else if (this.provider === 'voyage' && this.apiKey) {
      computedEmbeddings = await this._embedVoyage(missingTexts);
    } else {
      computedEmbeddings = this._embedLocal(missingTexts);
    }

    // 3. Fill results and save to cache
    for (let j = 0; j < missingIndices.length; j++) {
      const originalIdx = missingIndices[j];
      const embedding = computedEmbeddings[j];
      results[originalIdx] = embedding;

      if (this.cacheService) {
        try {
          const cacheKey = this._getCacheKey(texts[originalIdx]);
          // Cache for 30 days
          await this.cacheService.set(cacheKey, embedding, 2592000);
        } catch {
          // Non-fatal cache write failure
        }
      }
    }

    return results;
  }

  /**
   * OpenAI Embeddings API handler
   */
  async _embedOpenAI(texts) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: texts,
          model: this.model,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      return response.data.data.map(item => item.embedding);
    } catch (err) {
      this.logger.warn('OpenAI embedding failed, falling back to local dense vectorizer', {
        error: err.message,
      });
      return this._embedLocal(texts);
    }
  }

  /**
   * Voyage AI Embeddings API handler
   */
  async _embedVoyage(texts) {
    try {
      const response = await axios.post(
        'https://api.voyageai.com/v1/embeddings',
        {
          input: texts,
          model: 'voyage-finance-2',
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      return response.data.data.map(item => item.embedding);
    } catch (err) {
      this.logger.warn('Voyage AI embedding failed, falling back to local dense vectorizer', {
        error: err.message,
      });
      return this._embedLocal(texts);
    }
  }

  /**
   * Local High-Performance Dense Semantic Vectorizer
   * 
   * Uses financial feature hashing + subword n-grams + L2 unit normalization.
   * Produces dense, unit-length float vectors of size `this.dimensions` (384).
   * Cosine similarity between two vectors is given by their dot product.
   * 
   * @param {string[]} texts
   * @returns {number[][]}
   */
  _embedLocal(texts) {
    return texts.map(text => {
      const vector = new Float32Array(this.dimensions);
      const clean = (text || '').toLowerCase();
      
      // Extract words and character tri-grams
      const tokens = clean.match(/[a-z0-9\$\.\%\-]+/g) || [];

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        // Boost financial signals (tickers, numbers, dollar signs)
        const isTicker = /^[a-z]{1,5}$/.test(token) && token.length <= 4;
        const isFinancialNumber = /^\$?\d+/.test(token);
        const weight = isTicker ? 3.0 : isFinancialNumber ? 2.5 : 1.0;

        // Hash token to dimension index
        let h1 = 2166136261;
        for (let c = 0; c < token.length; c++) {
          h1 = Math.imul(h1 ^ token.charCodeAt(c), 16777619);
        }
        const idx1 = Math.abs(h1) % this.dimensions;
        vector[idx1] += weight;

        // Subword n-grams for semantic robustness
        if (token.length > 3) {
          for (let k = 0; k <= token.length - 3; k++) {
            const gram = token.slice(k, k + 3);
            let h2 = 0;
            for (let c = 0; c < 3; c++) {
              h2 = (h2 * 31 + gram.charCodeAt(c)) | 0;
            }
            const idx2 = Math.abs(h2) % this.dimensions;
            vector[idx2] += 0.4 * weight;
          }
        }
      }

      // L2 Normalization: ||v|| = 1
      let norm = 0;
      for (let d = 0; d < this.dimensions; d++) {
        norm += vector[d] * vector[d];
      }
      norm = Math.sqrt(norm);

      if (norm > 0) {
        for (let d = 0; d < this.dimensions; d++) {
          vector[d] /= norm;
        }
      }

      return Array.from(vector);
    });
  }

  /**
   * Computes cosine similarity between two unit vectors.
   * @param {number[]} a 
   * @param {number[]} b 
   * @returns {number}
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(0, Math.min(1, dot));
  }
}

export default EmbeddingClient;
